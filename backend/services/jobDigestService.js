
const { prisma } = require("../config/db");
const {
  sendDailyJobDigestEmail
} = require("./emailService");

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function getStudentSkills(skills) {
  if (!Array.isArray(skills)) return [];

  return skills
    .filter((skill) => typeof skill === "string")
    .map((skill) => normalizeText(skill))
    .filter(Boolean);
}

function isRecommendedJob(job, profile) {
  if (!profile) return false;

  const skills = getStudentSkills(profile.skills);

  const jobText = normalizeText(
    `${job.title || ""} ${job.description || ""} ${job.requirements || ""}`
  );

  const matchesSkill = skills.some((skill) => jobText.includes(skill));

  const studentLocation = normalizeText(profile.location);
  const jobLocation = normalizeText(job.location);
  const workMode = normalizeText(job.workMode);

  const matchesLocation =
    !studentLocation ||
    !jobLocation ||
    jobLocation.includes(studentLocation) ||
    workMode.includes("remote");

  return matchesSkill && matchesLocation;
}

function getDigestDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

/**
 * Send the regular digest to a student.
 * Only jobs created since the last digest/check are considered.
 * Previously delivered jobs are excluded.
 */
async function sendDigestForUser(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        digestPreference: true
      }
    });

    if (!user || !user.email) {
      return {
        success: false,
        message: "Student account or email address not found."
      };
    }

    const preference = user.digestPreference;

    if (!preference || !preference.enabled) {
      return {
        success: false,
        skipped: true,
        message: "Daily job digest is disabled."
      };
    }

    const startDate =
      preference.lastSentAt ||
      preference.enabledAt ||
      preference.createdAt;

    const now = new Date();

    const jobs = await prisma.job.findMany({
      where: {
        isActive: true,
        createdAt: {
          gt: startDate
        },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        company: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (jobs.length === 0) {
      await prisma.jobDigestPreference.update({
        where: { userId },
        data: {
          lastSentAt: now
        }
      });

      return {
        success: true,
        skipped: true,
        message: "No new jobs are available."
      };
    }

    const existingDeliveries = await prisma.jobDigestDelivery.findMany({
      where: {
        userId,
        jobId: {
          in: jobs.map((job) => job.id)
        }
      },
      select: {
        jobId: true
      }
    });

    const deliveredJobIds = new Set(
      existingDeliveries.map((delivery) => delivery.jobId)
    );

    const newJobs = jobs
      .filter((job) => !deliveredJobIds.has(job.id))
      .map((job) => ({
        ...job,
        isRecommended: isRecommendedJob(job, user.profile)
      }))
      .sort((a, b) => {
        if (a.isRecommended !== b.isRecommended) {
          return a.isRecommended ? -1 : 1;
        }

        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    if (newJobs.length === 0) {
      await prisma.jobDigestPreference.update({
        where: { userId },
        data: {
          lastSentAt: now
        }
      });

      return {
        success: true,
        skipped: true,
        message: "All available jobs were already delivered."
      };
    }

    const emailResult = await sendDailyJobDigestEmail(
      user.email,
      user.name || "Student",
      newJobs,
      now
    );

    if (!emailResult || emailResult.success !== true) {
      return {
        success: false,
        message: "Unable to send the job digest email."
      };
    }

    await prisma.jobDigestDelivery.createMany({
      data: newJobs.map((job) => ({
        userId,
        jobId: job.id,
        sentAt: now
      })),
      skipDuplicates: true
    });

    await prisma.jobDigestPreference.update({
      where: { userId },
      data: {
        lastSentAt: now
      }
    });

    return {
      success: true,
      message: "Daily job digest sent successfully.",
      jobsIncluded: newJobs.length,
      recommendedJobs: newJobs.filter((job) => job.isRecommended).length
    };
  } catch (error) {
    console.error("Daily job digest error:", error.message);

    return {
      success: false,
      message: "Unable to process the daily job digest."
    };
  }
}

/**
 * Process all students who have enabled the digest.
 */
async function processAllDailyDigests() {
  try {
    const preferences = await prisma.jobDigestPreference.findMany({
      where: {
        enabled: true
      },
      select: {
        userId: true
      }
    });

    const results = [];

    for (const preference of preferences) {
      const result = await sendDigestForUser(preference.userId);

      results.push({
        userId: preference.userId,
        ...result
      });
    }

    return results;
  } catch (error) {
    console.error("Processing daily digests failed:", error.message);
    return [];
  }
}

/**
 * Send a test digest to the currently logged-in student's email.
 *
 * This does not require the preference to be enabled.
 * It does not record deliveries or update lastSentAt.
 */
async function sendTestDigestForUser(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true
      }
    });

    if (!user || !user.email) {
      return {
        success: false,
        message: "Student account or email address not found."
      };
    }

    const now = new Date();

    const jobs = await prisma.job.findMany({
      where: {
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        company: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 10
    });

    const digestJobs = jobs
      .map((job) => ({
        ...job,
        isRecommended: isRecommendedJob(job, user.profile)
      }))
      .sort((a, b) => {
        if (a.isRecommended !== b.isRecommended) {
          return a.isRecommended ? -1 : 1;
        }

        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    if (digestJobs.length === 0) {
      return {
        success: true,
        skipped: true,
        message: "No active jobs are available for the test email."
      };
    }

    const result = await sendDailyJobDigestEmail(
      user.email,
      user.name || "Student",
      digestJobs,
      now
    );

    if (!result || result.success !== true) {
      return {
        success: false,
        message: "Unable to send the test digest email."
      };
    }

    return {
      success: true,
      message: "Test digest email sent successfully.",
      recipient: user.email,
      jobsIncluded: digestJobs.length,
      recommendedJobs: digestJobs.filter(
        (job) => job.isRecommended
      ).length
    };
  } catch (error) {
    console.error("Test digest email failed:", error.message);

    return {
      success: false,
      message: "Unable to send the test digest email."
    };
  }
}

module.exports = {
  sendDigestForUser,
  processAllDailyDigests,
  sendTestDigestForUser,
  isRecommendedJob,
  getDigestDate
};

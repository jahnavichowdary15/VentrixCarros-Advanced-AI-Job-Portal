const cron = require("node-cron");
const { prisma } = require("../config/db");
const { sendDigestForUser } = require("./jobDigestService");

const TIMEZONE = "Asia/Kolkata";

let isRunning = false;

function getCurrentISTTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = parts.find((part) => part.type === "hour").value;
  const minute = parts.find((part) => part.type === "minute").value;

  return `${hour}:${minute}`;
}

function getISTDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

async function processDailyDigests() {
  if (isRunning) return;

  isRunning = true;

  try {
    const currentTime = getCurrentISTTime();
    const today = getISTDateKey(new Date());

    const duePreferences = await prisma.jobDigestPreference.findMany({
      where: {
        enabled: true,
        sendTime: currentTime,
      },
      select: {
        userId: true,
        lastSentAt: true,
      },
    });

    for (const preference of duePreferences) {
      if (
        preference.lastSentAt &&
        getISTDateKey(preference.lastSentAt) === today
      ) {
        continue;
      }

      try {
        const result = await sendDigestForUser(preference.userId);

        console.log(
          `[Job Digest] User ${preference.userId}: ${
            result?.message || result?.status || "Processed"
          }`
        );
      } catch (error) {
        console.error(
          `[Job Digest] Failed for user ${preference.userId}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("[Job Digest Scheduler] Error:", error);
  } finally {
    isRunning = false;
  }
}

function startJobDigestScheduler() {
  const task = cron.schedule(
    "* * * * *",
    processDailyDigests,
    {
      timezone: TIMEZONE,
    }
  );

  console.log(
    "[Job Digest Scheduler] Started. Timezone: Asia/Kolkata"
  );

  return task;
}

module.exports = {
  startJobDigestScheduler,
};

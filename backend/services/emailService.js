const { Resend } = require("resend");

// Initialize Resend
function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    const error = new Error("RESEND_API_KEY is missing");
    error.code = "EMAIL_CONFIG_MISSING";
    throw error;
  }

  return new Resend(apiKey);
}

// Get sender email
function getEmailFrom() {
  const emailFrom = process.env.EMAIL_FROM;

  if (!emailFrom) {
    const error = new Error("EMAIL_FROM is missing");
    error.code = "EMAIL_CONFIG_MISSING";
    throw error;
  }

  return emailFrom;
}

// Escape dynamic HTML values
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

// Common email sending function
async function sendEmail({ to, subject, text, html }) {
  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: getEmailFrom(),
    to: [to],
    subject,
    text,
    html
  });

  if (error) {
    console.error("Resend email error:", {
      message: error.message,
      name: error.name
    });

    const sendError = new Error(error.message || "Email sending failed");
    sendError.code = "RESEND_SEND_FAILED";
    throw sendError;
  }

  console.log("Email sent successfully through Resend:", {
    messageId: data?.id
  });

  return data;
}


// ========================================
// OTP EMAIL
// ========================================

async function sendOtpEmail(email, otp, purpose = "signup") {
  const isLogin = purpose === "login";

  const subject = isLogin
    ? "Your VentrixCarros login verification code"
    : "Your VentrixCarros email verification code";

  const heading = isLogin
    ? "Verify your login"
    : "Verify your email";

  const instruction = isLogin
    ? "Use this code to finish signing in to your VentrixCarros account:"
    : "Use this code to verify your email address:";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#172033">
      <h2>${heading}</h2>

      <p>${instruction}</p>

      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:18px;background:#f1f5f9;text-align:center;border-radius:8px">
        ${escapeHtml(otp)}
      </div>

      <p>This code expires in <strong>5 minutes</strong>.</p>

      <p>If you did not request this code, please ignore this email.</p>

      <p style="color:#64748b;font-size:12px">
        VentrixCarros
      </p>
    </div>
  `;

  const text = [
    "Hello,",
    "",
    instruction,
    "",
    `Your verification code is: ${otp}`,
    "",
    "This code expires in 5 minutes.",
    "If you did not request this code, please ignore this email.",
    "",
    "VentrixCarros"
  ].join("\n");

  return sendEmail({
    to: email,
    subject,
    text,
    html
  });
}


// ========================================
// LOGIN ALERT EMAIL
// ========================================

async function sendLoginAlertEmail(email, name) {
  const loginDate = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "long",
    timeStyle: "short"
  });

  const safeName = escapeHtml(name || "Student");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#172033">

      <h2 style="color:#2563eb">New Login Detected</h2>

      <p>Hello ${safeName},</p>

      <p>Your VentrixCarros account was successfully accessed.</p>

      <div style="background:#eff6ff;padding:18px;border-radius:8px">

        <strong>Login date and time</strong>

        <p>${escapeHtml(loginDate)} (IST)</p>

        <strong>Login status</strong>

        <p>Successful</p>

      </div>

      <p>
        If this login was not performed by you, please change your
        password and contact our support team.
      </p>

      <p style="color:#64748b;font-size:12px">
        VentrixCarros Security Team
      </p>

    </div>
  `;

  const text = [
    `Hello ${String(name || "Student")},`,
    "",
    "Your VentrixCarros account was successfully accessed.",
    "",
    `Login date and time: ${loginDate} (IST)`,
    "",
    "If this login was not performed by you, please change your password and contact our support team.",
    "",
    "VentrixCarros Security Team"
  ].join("\n");

  return sendEmail({
    to: email,
    subject: "New login to your VentrixCarros account",
    text,
    html
  });
}


// ========================================
// DAILY JOB EMAIL DIGEST
// ========================================

async function sendDailyJobDigestEmail(
  email,
  name,
  jobs = [],
  digestDate = new Date()
) {
  if (!Array.isArray(jobs)) {
    throw new Error("Daily job digest jobs must be an array.");
  }

  if (jobs.length === 0) {
    return {
      success: true,
      skipped: true,
      message: "No jobs available for this digest."
    };
  }

  const safeName = escapeHtml(name || "Student");

  const formattedDate = new Date(digestDate).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const frontendUrl = (
    process.env.FRONTEND_URL || "http://localhost:5500"
  ).replace(/\/+$/, "");

  const validJobs = jobs.filter((job) => job && job.id);

  if (validJobs.length === 0) {
    return {
      success: true,
      skipped: true,
      message: "No valid jobs available for this digest."
    };
  }

  const jobCards = validJobs.map((job) => {
    const title = escapeHtml(job.title || "Untitled Job");
    const company = escapeHtml(job.company?.name || "Company");
    const location = escapeHtml(job.location || "Location not specified");

    const jobType = escapeHtml(
      String(job.jobType || "JOB").replace(/_/g, " ")
    );

    const workMode = escapeHtml(job.workMode || "Not specified");

    const isRecommended = job.isRecommended === true;

    const jobUrl = `${frontendUrl}/jobs.html?jobId=${encodeURIComponent(
      String(job.id)
    )}`;

    const safeJobUrl = escapeHtml(jobUrl);

    return {
      html: `
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:16px">

          ${
            isRecommended
              ? '<div style="color:#2563eb;font-size:12px;font-weight:bold;margin-bottom:8px">★ RECOMMENDED FOR YOU</div>'
              : ""
          }

          <h3 style="margin:0 0 8px;color:#172033">${title}</h3>

          <p style="margin:0 0 10px;color:#475569;font-weight:bold">${company}</p>

          <p style="margin:5px 0;color:#64748b">Location: ${location}</p>

          <p style="margin:5px 0;color:#64748b">Job type: ${jobType}</p>

          <p style="margin:5px 0;color:#64748b">Work mode: ${workMode}</p>

          <a href="${safeJobUrl}" style="display:inline-block;margin-top:12px;padding:11px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">
            View Job
          </a>

        </div>
      `,

      text: [
        `${isRecommended ? "[RECOMMENDED] " : ""}${job.title || "Untitled Job"}`,
        `Company: ${job.company?.name || "Company"}`,
        `Location: ${job.location || "Location not specified"}`,
        `Job type: ${jobType}`,
        `Work mode: ${workMode}`,
        `View job: ${jobUrl}`
      ].join("\n")
    };
  });

  const recommendedCount = validJobs.filter(
    (job) => job.isRecommended === true
  ).length;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#172033;background:#ffffff">

      <div style="background:#172554;padding:24px;border-radius:10px;color:#ffffff">

        <h1 style="margin:0;font-size:25px">VentrixCarros</h1>

        <p style="margin:8px 0 0;color:#dbeafe">Your Daily Job Digest</p>

      </div>

      <div style="padding:20px 0">

        <h2>Hello ${safeName}!</h2>

        <p>Here are the latest job opportunities available on VentrixCarros.</p>

        <p style="color:#64748b">
          Digest date: <strong>${escapeHtml(formattedDate)} (IST)</strong>
        </p>

        <div style="background:#eff6ff;padding:14px;border-radius:8px;margin:16px 0">

          <strong>${validJobs.length} job opportunities</strong>

          <p style="margin:6px 0 0;color:#475569">
            ${recommendedCount} recommended opportunities based on your profile.
          </p>

        </div>

        <h2 style="font-size:19px;margin-top:24px">Your Job Opportunities</h2>

        ${jobCards.map((job) => job.html).join("")}

        <p style="margin-top:24px">

          <a href="${escapeHtml(`${frontendUrl}/jobs.html`)}" style="display:inline-block;padding:12px 20px;background:#172554;color:#ffffff;text-decoration:none;border-radius:6px">
            Explore All Jobs
          </a>

        </p>

        <p style="color:#64748b;font-size:13px;line-height:1.6">
          Keep your profile and skills updated to receive more relevant job recommendations.
        </p>

      </div>

      <div style="border-top:1px solid #e2e8f0;padding-top:16px;color:#94a3b8;font-size:12px">

        <p>You are receiving this email because Daily Job Email Digest is enabled in your VentrixCarros account.</p>

        <p>VentrixCarros | Your Career, Your Future.</p>

      </div>

    </div>
  `;

  const text = [
    "VENTRIXCARROS - DAILY JOB DIGEST",
    `Hello ${String(name || "Student")}!`,
    `Digest date: ${formattedDate} (IST)`,
    `${validJobs.length} job opportunities`,
    `${recommendedCount} recommended opportunities`,
    "",
    ...jobCards.map((job) => job.text),
    "",
    `Explore all jobs: ${frontendUrl}/jobs.html`,
    "",
    "VentrixCarros"
  ].join("\n\n");

  return sendEmail({
    to: email,
    subject: `Your Daily Job Digest - ${formattedDate}`,
    text,
    html
  });
}


// ========================================
// EXPORT FUNCTIONS
// ========================================

module.exports = {
  sendOtpEmail,
  sendLoginAlertEmail,
  sendDailyJobDigestEmail
};

const nodemailer = require("nodemailer");

function createEmailTransporter() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    const error = new Error(
      "Missing GMAIL_USER or GMAIL_APP_PASSWORD in backend/.env"
    );
    error.code = "EMAIL_CONFIG_MISSING";
    throw error;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser.trim(),
      pass: gmailAppPassword.replace(/\s/g, "")
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

async function sendOtpEmail(email, otp, purpose = "signup") {
  const gmailUser = process.env.GMAIL_USER;

  if (!gmailUser || !process.env.GMAIL_APP_PASSWORD) {
    const error = new Error(
      "Gmail environment variables are missing"
    );
    error.code = "EMAIL_CONFIG_MISSING";
    throw error;
  }

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

  const transporter = createEmailTransporter();

  const mailOptions = {
    from: {
      name: "VentrixCarros",
      address: gmailUser.trim()
    },
    to: email,
    subject,
    text: [
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
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#172033">
        <h2>${heading}</h2>
        <p>${instruction}</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:18px;background:#f1f5f9;text-align:center;border-radius:8px">
          ${otp}
        </div>
        <p>This code expires in <strong>5 minutes</strong>.</p>
        <p>If you did not request this code, please ignore this email.</p>
        <p style="color:#64748b;font-size:12px">VentrixCarros</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    console.log("OTP email accepted by mail server:", {
      messageId: info.messageId,
      acceptedCount: info.accepted?.length ?? 0,
      rejectedCount: info.rejected?.length ?? 0
    });

    if (!info.accepted || info.accepted.length === 0) {
      const error = new Error(
        "The mail server did not accept the recipient"
      );
      error.code = "EMAIL_RECIPIENT_NOT_ACCEPTED";
      throw error;
    }

    return info;
  } finally {
    transporter.close();
  }
}

module.exports = { sendOtpEmail };

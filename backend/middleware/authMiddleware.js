
const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please log in."
    });
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is missing."
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      success: false,
      message: "Authentication is not configured correctly."
    });
  }

  try {
    const payload = jwt.verify(token, secret);

    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      typeof payload.role !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token."
      });
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role
    };

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Authentication token is invalid or expired. Please log in again."
    });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource."
      });
    }

    return next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles
};


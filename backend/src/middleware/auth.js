const { verifyToken } = require("../utils/jwt");
const { ApiError } = require("../utils/asyncHandler");

function getTokenFromHeader(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function requireAdmin(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) return next(new ApiError(401, "Missing admin token"));
  try {
    const payload = verifyToken(token);
    if (payload.role !== "admin") {
      return next(new ApiError(403, "Admin access required"));
    }
    req.admin = payload;
    next();
  } catch (err) {
    next(new ApiError(401, "Invalid or expired admin session"));
  }
}

function requireStudent(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) return next(new ApiError(401, "Missing student session token"));
  try {
    const payload = verifyToken(token);
    if (payload.role !== "student") {
      return next(new ApiError(403, "Student access required"));
    }
    req.student = payload;
    next();
  } catch (err) {
    next(new ApiError(401, "Invalid or expired quiz session"));
  }
}

module.exports = { requireAdmin, requireStudent };

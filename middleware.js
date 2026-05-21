const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { User, Notification } = require("./models");
const { hasPermission } = require("./permissions");

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|pdf/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) || file.mimetype.startsWith("image/");
    cb(ok ? null : new Error("Invalid file type"), ok);
  },
});

const optionalProtect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
  } catch {
    req.user = null;
  }
  next();
};

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized, no token", data: null });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user || !req.user.isActive) {
      return res.status(401).json({ success: false, message: "User not found or deactivated", data: null });
    }
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Token invalid or expired", data: null });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied for this role", data: null });
  }
  next();
};

const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user.role, permission)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions", data: null });
  }
  next();
};

const createNotification = async ({ recipient, issue, type, title, message }) => {
  try {
    await Notification.create({ recipient, issue, type, title, message });
  } catch (err) {
    console.error("Notification error:", err.message);
  }
};

const errorHandler = (err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Server error",
    data: null,
  });
};

module.exports = {
  protect,
  optionalProtect,
  authorize,
  requirePermission,
  upload,
  createNotification,
  errorHandler,
};

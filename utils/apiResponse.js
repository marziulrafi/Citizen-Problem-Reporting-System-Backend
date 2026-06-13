const sendSuccess = (res, { status = 200, message, data = null } = {}) =>
  res.status(status).json({ success: true, message, data });

const sendError = (res, { status = 400, message, data = null } = {}) =>
  res.status(status).json({ success: false, message, data });

module.exports = { sendSuccess, sendError };

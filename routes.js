const express = require("express");
const {
  // Auth
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  // Issues
  createIssue,
  getIssues,
  getMyIssues,
  getPublicFeed,
  getIssueById,
  updateIssueStatus,
  assignIssue,
  upvoteIssue,
  deleteIssue,
  getIssueHistory,
  // Moderation
  getIssuesForModeration,
  verifyIssue,
  rejectIssue,
  // Teams
  createTeam,
  getTeams,
  updateTeam,
  getTeamStats,
  // Comments
  addComment,
  getComments,
  // Notifications
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  // Admin
  getDashboardStats,
  getAllUsers,
  toggleUserStatus,
  updateUserRole,
  getWorkers,
  getCategoryStats,
  getDhakaZones,
  getZoneAuthorities,
} = require("./controllers");
const { protect, optionalProtect, authorize, upload } = require("./middleware");

const router = express.Router();

// ============== HEALTH ==============
router.get("/health", (_req, res) => {
  res.json({ success: true, message: "CPRS API is running", data: null });
});

// ============== AUTH ==============
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", protect, getMe);
router.put("/auth/profile", protect, upload.single("profilePhoto"), updateProfile);
router.put("/auth/password", protect, changePassword);

// ============== PUBLIC ISSUES ==============
router.get("/issues/public", getPublicFeed);
router.get("/issues/stats/categories", getCategoryStats);
router.get("/zones", getDhakaZones);
router.get("/zones/authorities", protect, authorize("moderator", "admin"), getZoneAuthorities);

// ============== PRIVATE ISSUES ==============
router.get("/issues/my", protect, getMyIssues);
router.get("/issues", protect, getIssues);
router.get("/issues/:id", optionalProtect, getIssueById);
router.get("/issues/:id/history", optionalProtect, getIssueHistory);
router.get("/issues/:id/comments", getComments);
router.post("/issues/:id/comments", protect, addComment);
router.post("/issues", protect, upload.array("media", 5), createIssue);
router.put("/issues/:id/status", protect, upload.array("repairProof", 3), updateIssueStatus);
router.put("/issues/:id/assign", protect, authorize("authority", "admin"), assignIssue);
router.put("/issues/:id/upvote", protect, upvoteIssue);
router.delete("/issues/:id", protect, deleteIssue);

// ============== MODERATION ==============
router.get("/moderation/issues", protect, authorize("moderator", "admin"), getIssuesForModeration);
router.put("/moderation/issues/:id/verify", protect, authorize("moderator", "admin"), verifyIssue);
router.put("/moderation/issues/:id/reject", protect, authorize("moderator", "admin"), rejectIssue);

// ============== TEAMS ==============
router.post("/teams", protect, authorize("authority", "admin"), createTeam);
router.get("/teams", protect, authorize("authority", "admin"), getTeams);
router.put("/teams/:teamId", protect, authorize("authority", "admin"), updateTeam);
router.get("/teams/:teamId/stats", protect, getTeamStats);

// ============== NOTIFICATIONS ==============
router.get("/notifications", protect, getNotifications);
router.put("/notifications/:id/read", protect, markNotificationRead);
router.put("/notifications/read-all", protect, markAllNotificationsRead);

// ============== ADMIN ==============
router.get("/admin/dashboard", protect, authorize("admin", "authority", "field_worker", "moderator"), getDashboardStats);
router.get("/admin/users", protect, authorize("admin"), getAllUsers);
router.put("/admin/users/:userId/toggle", protect, authorize("admin"), toggleUserStatus);
router.put("/admin/users/:userId/role", protect, authorize("admin"), updateUserRole);
router.get("/admin/workers", protect, authorize("authority", "admin"), getWorkers);

module.exports = router;

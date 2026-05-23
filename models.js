const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROLES = ["citizen", "admin", "authority", "field_worker", "moderator"];
const ISSUE_STATUSES = [
  "submitted",
  "verified",
  "assigned",
  "in_progress",
  "pending_review",
  "resolved",
  "reopened",
  "closed",
];
const ACTIVITY_TYPES = [
  "issue_created",
  "issue_verified",
  "issue_assigned",
  "status_updated",
  "worker_updated",
  "issue_resolved",
  "comment_added",
  "user_created",
  "team_created",
];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: { type: String, required: true, minlength: 8 },
    phone: { type: String, default: "" },
    role: { type: String, enum: ROLES, default: "citizen" },
    departmentName: { type: String, default: "" },
    zone: { type: String, default: "" },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    profilePhoto: { type: String, default: "" },
    address: { type: String, default: "" },
    ward: { type: String, default: "" },
    preferredLanguage: { type: String, enum: ["bn", "en"], default: "en" },
    isActive: { type: Boolean, default: true },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    statistics: {
      issuesCreated: { type: Number, default: 0 },
      issuesResolved: { type: Number, default: 0 },
      issuesAssigned: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

const issueSchema = new mongoose.Schema(
  {
    issueId: { type: String, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, minlength: 20 },
    category: {
      type: String,
      required: true,
      enum: [
        "road_transportation",
        "water_sanitation",
        "electricity",
        "waste_management",
        "public_safety",
        "environmental",
        "other",
      ],
    },
    subCategory: { type: String, default: "" },
    priority: {
      type: String,
      enum: ["emergency", "high", "medium", "low"],
      default: "medium",
    },
    status: { type: String, enum: ISSUE_STATUSES, default: "submitted" },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [90.4125, 23.8103] },
    },
    address: { type: String, default: "" },
    zone: { type: String, default: "" },
    division: { type: String, default: "Dhaka" },
    district: { type: String, default: "Dhaka" },
    upazila: { type: String, default: "" },
    ward: { type: String, default: "" },
    landmark: { type: String, default: "" },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    assignedWorkers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isAnonymous: { type: Boolean, default: false },
    media: [
      {
        url: String,
        type: { type: String, enum: ["image", "video", "audio", "document"] },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    repairProof: [
      {
        url: String,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        uploadedAt: { type: Date, default: Date.now },
        note: { type: String, default: "" },
      },
    ],
    severity: { type: Number, min: 1, max: 5, default: 3 },
    affectedPeople: { type: Number, default: 0 },
    upvoteCount: { type: Number, default: 0 },
    upvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    resolutionNote: { type: String, default: "" },
    expectedResolutionAt: { type: Date },
    resolvedAt: { type: Date },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    moderationNote: { type: String, default: "" },
    verifiedAt: { type: Date },
    rejectionReason: { type: String, default: "" },
    currentProgress: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

issueSchema.index({ location: "2dsphere" });
issueSchema.index({ status: 1, category: 1, createdAt: -1 });

issueSchema.pre("save", async function (next) {
  if (!this.issueId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Issue").countDocuments();
    this.issueId = `ISSUE-${year}-${String(count + 1).padStart(6, "0")}`;
  }
  if (!this.expectedResolutionAt) {
    const hours = { emergency: 2, high: 24, medium: 72, low: 168 };
    const h = hours[this.priority] || 72;
    this.expectedResolutionAt = new Date(Date.now() + h * 60 * 60 * 1000);
  }
  next();
});

const issueHistorySchema = new mongoose.Schema(
  {
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    action: { type: String, required: true },
    fromStatus: String,
    toStatus: String,
    note: { type: String, default: "" },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue" },
    type: {
      type: String,
      enum: ["status_changed", "assigned", "verified", "resolved", "comment", "system"],
      default: "system",
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const commentSchema = new mongoose.Schema(
  {
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 1000 },
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    zone: { type: String, default: "" },
    department: { type: String, default: "" },
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    maxMembers: { type: Number, default: 7 },
    isActive: { type: Boolean, default: true },
    statistics: {
      totalIssuesAssigned: { type: Number, default: 0 },
      totalIssuesResolved: { type: Number, default: 0 },
      averageResolutionTime: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

const activityLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    description: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Issue = mongoose.model("Issue", issueSchema);
const IssueHistory = mongoose.model("IssueHistory", issueHistorySchema);
const Notification = mongoose.model("Notification", notificationSchema);
const Comment = mongoose.model("Comment", commentSchema);
const Team = mongoose.model("Team", teamSchema);
const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

module.exports = {
  User,
  Issue,
  IssueHistory,
  Notification,
  Comment,
  Team,
  ActivityLog,
  ROLES,
  ISSUE_STATUSES,
  ACTIVITY_TYPES,
};

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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
    role: {
      type: String,
      enum: ["citizen", "admin"],
      default: "citizen",
    },
    isActive: { type: Boolean, default: true },
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
  return await bcrypt.compare(enteredPassword, this.password);
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
    priority: {
      type: String,
      enum: ["emergency", "high", "medium", "low"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["submitted", "resolved", "closed"],
      default: "submitted",
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    address: { type: String, default: "" },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isAnonymous: { type: Boolean, default: false },
    media: [
      {
        url: String,
        type: { type: String, enum: ["image", "video", "audio", "document"] },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    severity: { type: Number, min: 1, max: 5, default: 3 },
    affectedPeople: { type: Number, default: 0 },
    expectedResolutionAt: { type: Date },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

issueSchema.index({ location: "2dsphere" });

issueSchema.pre("save", async function (next) {
  if (!this.issueId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Issue").countDocuments();
    const seq = String(count + 1).padStart(6, "0");
    this.issueId = `ISSUE-${year}-${seq}`;
  }
  if (!this.expectedResolutionAt) {
    const hours = { emergency: 2, high: 24, medium: 72, low: 168 };
    const h = hours[this.priority] || 72;
    this.expectedResolutionAt = new Date(Date.now() + h * 60 * 60 * 1000);
  }
  next();
});

const User = mongoose.model("User", userSchema);
const Issue = mongoose.model("Issue", issueSchema);

module.exports = { User, Issue };

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// User
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
    phone: {
      type: String,
      trim: true,
      match: [/^01[3-9]\d{8}$/, "Please enter a valid Bangladeshi phone number"],
    },
    password: { type: String, required: true, minlength: 8 },
    role: {
      type: String,
      enum: ["citizen", "authority", "admin"],
      default: "citizen",
    },
    profilePhoto: { type: String, default: "" },
    address: { type: String, default: "" },
    ward: { type: String, default: "" },
    preferredLanguage: { type: String, enum: ["bn", "en"], default: "en" },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    departmentName: { type: String, default: "" },
    jurisdictionArea: { type: String, default: "" },
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

userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};



// Issue
const issueSchema = new mongoose.Schema(
  {
    issueId: { type: String, unique: true }, // e.g. DHA-D-2024-004567
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
    status: {
      type: String,
      enum: [
        "submitted",
        "verified",
        "assigned",
        "in_progress",
        "pending_review",
        "resolved",
        "reopened",
        "closed",
      ],
      default: "submitted",
    },

    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    address: { type: String, default: "" },
    division: { type: String, default: "" },
    district: { type: String, default: "" },
    upazila: { type: String, default: "" },
    ward: { type: String, default: "" },
    landmark: { type: String, default: "" },

    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isAnonymous: { type: Boolean, default: false },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date },

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
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    upvoteCount: { type: Number, default: 0 },

    resolvedAt: { type: Date },
    resolutionNote: { type: String, default: "" },

    expectedResolutionAt: { type: Date },
    isEscalated: { type: Boolean, default: false },

    severity: { type: Number, min: 1, max: 5, default: 3 },
    affectedPeople: { type: Number, default: 0 },
  },
  { timestamps: true }
);


issueSchema.index({ location: "2dsphere" });
issueSchema.index({ status: 1, priority: 1 });
issueSchema.index({ reportedBy: 1 });
issueSchema.index({ assignedTo: 1 });

issueSchema.pre("save", async function (next) {
  if (!this.issueId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Issue").countDocuments();
    const seq = String(count + 1).padStart(6, "0");
    this.district = this.district || "DHA";
    this.issueId = `${this.district.toUpperCase().slice(0, 3)}-${year}-${seq}`;
  }
  if (!this.expectedResolutionAt) {
    const hours = { emergency: 2, high: 24, medium: 72, low: 168 };
    const h = hours[this.priority] || 72;
    this.expectedResolutionAt = new Date(Date.now() + h * 60 * 60 * 1000);
  }
  next();
});
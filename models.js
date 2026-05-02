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
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    departmentName: { type: String, default: "" },
    jurisdictionArea: { type: String, default: "" },
  },
  { timestamps: true }
);
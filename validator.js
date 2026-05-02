const userRegisterDTO = {
  name: (val) => typeof val === "string" && val.length >= 3 && val.length <= 50,
  email: (val) => /^\S+@\S+\.\S+$/.test(val),
  phone: (val) => !val || /^01[3-9]\d{8}$/.test(val),
  password: (val) => typeof val === "string" && val.length >= 8,
  role: (val) => !val || ["citizen", "authority", "admin"].includes(val),
  preferredLanguage: (val) => !val || ["bn", "en"].includes(val),
};

const userUpdateProfileDTO = {
  name: (val) => typeof val === "string" && val.length >= 3 && val.length <= 50,
  phone: (val) => !val || /^01[3-9]\d{8}$/.test(val),
  address: (val) => !val || typeof val === "string",
  ward: (val) => !val || typeof val === "string",
  preferredLanguage: (val) => !val || ["bn", "en"].includes(val),
};

const issueCreateDTO = {
  title: (val) => typeof val === "string" && val.length > 0 && val.length <= 150,
  description: (val) => typeof val === "string" && val.length >= 20,
  category: (val) =>
    [
      "road_transportation",
      "water_sanitation",
      "electricity",
      "waste_management",
      "public_safety",
      "environmental",
      "other",
    ].includes(val),
  subCategory: (val) => !val || typeof val === "string",
  priority: (val) => !val || ["emergency", "high", "medium", "low"].includes(val),
  address: (val) => !val || typeof val === "string",
  division: (val) => !val || typeof val === "string",
  district: (val) => !val || typeof val === "string",
  upazila: (val) => !val || typeof val === "string",
  ward: (val) => !val || typeof val === "string",
  landmark: (val) => !val || typeof val === "string",
  latitude: (val) => !val || typeof val === "number" || typeof val === "string",
  longitude: (val) => !val || typeof val === "number" || typeof val === "string",
  isAnonymous: (val) => !val || typeof val === "boolean" || val === "true" || val === "false",
  severity: (val) =>
    !val ||
    ((typeof val === "number" || (typeof val === "string" && /^\d+$/.test(val))) &&
      Number(val) >= 1 &&
      Number(val) <= 5),
  affectedPeople: (val) =>
    !val || typeof val === "number" || (typeof val === "string" && /^\d+$/.test(val)),
};

const issueUpdateStatusDTO = {
  status: (val) =>
    [
      "submitted",
      "verified",
      "assigned",
      "in_progress",
      "pending_review",
      "resolved",
      "reopened",
      "closed",
    ].includes(val),
  resolutionNote: (val) => !val || typeof val === "string",
};

const issueAssignDTO = {
  assignedTo: (val) => typeof val === "string" && val.length > 0,
};

const commentCreateDTO = {
  text: (val) => typeof val === "string" && val.length > 0 && val.length <= 1000,
  isAnonymous: (val) => !val || typeof val === "boolean" || val === "true" || val === "false",
};

const feedbackCreateDTO = {
  rating: (val) => typeof val === "number" && val >= 1 && val <= 5,
  comment: (val) => !val || (typeof val === "string" && val.length <= 500),
  ratedAuthority: (val) => !val || typeof val === "string",
};

function validateAndExtract(data, whitelist, requiredFields = []) {
  const validated = {};
  const errors = [];

  for (const [field, validator] of Object.entries(whitelist)) {
    if (field in data) {
      const value = data[field];

      if (validator(value)) {
        validated[field] = value;
      } else {
        errors.push(`Invalid value for field '${field}'`);
      }
    }
  }

  for (const field of requiredFields) {
    if (!(field in validated)) {
      errors.push(`Missing required field '${field}'`);
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(", "));
    err.statusCode = 400;
    throw err;
  }

  return validated;
}

module.exports = {
  validateUserRegister: (data) =>
    validateAndExtract(data, userRegisterDTO, ["name", "email", "password"]),
  validateUserUpdateProfile: (data) => validateAndExtract(data, userUpdateProfileDTO),
  validateIssueCreate: (data) =>
    validateAndExtract(data, issueCreateDTO, ["title", "description", "category"]),
  validateIssueUpdateStatus: (data) =>
    validateAndExtract(data, issueUpdateStatusDTO, ["status"]),
  validateIssueAssign: (data) => validateAndExtract(data, issueAssignDTO, ["assignedTo"]),
  validateCommentCreate: (data) => validateAndExtract(data, commentCreateDTO, ["text"]),
  validateFeedbackCreate: (data) => validateAndExtract(data, feedbackCreateDTO, ["rating"]),
};
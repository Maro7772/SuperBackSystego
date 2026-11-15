import Joi from "joi";

export const signupSchema = Joi.object({
  name: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  imageBase64: Joi.string().optional(),
});
export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

export const verifyEmailSchema = Joi.object({
  userId: Joi.string().required(),
  code: Joi.string().required(),
});

export const sendResetCodeSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const checkResetCodeSchema = Joi.object({
  email: Joi.string().required(),
  code: Joi.string().required(),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().required(),
  code: Joi.string().required(),
  newPassword: Joi.string().min(6).max(30).required(),
});

export const createAdminSchema = Joi.object({
  name: Joi.string().min(3).max(50).required().messages({
    "string.min": "Name must be at least 3 characters",
    "string.max": "Name cannot exceed 50 characters",
    "any.required": "Name is required",
  }),
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email",
    "any.required": "Email is required",
  }),
  password: Joi.string().min(6).max(30).required().messages({
    "string.min": "Password must be at least 6 characters",
    "any.required": "Password is required",
  }),
  role: Joi.string().valid("super_admin", "viewer").default("viewer").messages({
    "any.only": "Role must be either super_admin or viewer",
  }),
});

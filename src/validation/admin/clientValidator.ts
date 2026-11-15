import Joi from "joi";

export const createClientValidator = Joi.object({
  company_name: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Company name is required",
    "string.min": "Company name must be at least 2 characters long",
    "string.max": "Company name cannot exceed 100 characters",
    "any.required": "Company name is required",
  }),

  email: Joi.string().email().lowercase().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
    "any.required": "Email is required",
  }),

  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters long",
    "string.empty": "Password is required",
    "any.required": "Password is required",
  }),

  status: Joi.string()
    .valid("active", "inactive", "suspended")
    .default("active")
    .messages({
      "any.only": "Status must be one of: active, inactive, suspended",
    }),

  operation_status: Joi.string()
    .valid("Demo", "Sales", "Data", "Delivered")
    .default("Demo")
    .optional(),

  package_id: Joi.string().hex().length(24).optional().messages({
    "string.hex": "Package ID must be a valid hexadecimal string",
    "string.length": "Package ID must be exactly 24 characters long",
  }),

  subdomain: Joi.string()
    .trim()
    .lowercase()
    .min(3)
    .max(63)
    .pattern(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .required()
    .messages({
      "string.empty": "Subdomain name is required",
      "string.min": "Subdomain name must be at least 3 characters long",
      "string.max": "Subdomain name cannot exceed 63 characters",
      "string.pattern.base":
        "Subdomain must contain only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.",
      "any.required": "Subdomain name is required",
    }),

  logoBase64: Joi.string().optional().allow("").messages({
    "string.base": "Logo must be a valid base64 string",
  }),

  // ✅ الحقول الجديدة
  main_location: Joi.string().trim().allow("", null).optional(),
  branches_locations: Joi.array().items(Joi.string().trim()).optional(),
  branches_config: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().trim().allow("", null),
        Is_Online: Joi.boolean().default(false),
      }),
    )
    .optional(),
  payment_cycle: Joi.string()
    .valid("monthly", "quarterly", "half_yearly", "yearly")
    .optional()
    .messages({
      "any.only":
        "Payment cycle must be one of: monthly, quarterly, half_yearly, yearly",
    }),
  payment_amount: Joi.number().min(0).allow(null, "").optional(),
  contact_person_name: Joi.string().trim().allow("", null).optional(),
  contact_person_phone: Joi.string().trim().allow("", null).optional(),
  sales_man_name: Joi.string().trim().allow("", null).optional(),
  sales_man_phone: Joi.string().trim().allow("", null).optional(),
  subscription_end_date: Joi.date().allow(null, "").optional(),
});

export const updateClientValidator = Joi.object({
  company_name: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Company name must be at least 2 characters long",
    "string.max": "Company name cannot exceed 100 characters",
  }),

  email: Joi.string().email().lowercase().trim().optional().messages({
    "string.email": "Please provide a valid email address",
  }),

  password: Joi.string().min(6).optional().messages({
    "string.min": "Password must be at least 6 characters long",
  }),

  status: Joi.string()
    .valid("active", "inactive", "suspended")
    .optional()
    .messages({
      "any.only": "Status must be one of: active, inactive, suspended",
    }),

  operation_status: Joi.string()
    .valid("Demo", "Sales", "Data", "Delivered")
    .optional(),

  package_id: Joi.string().hex().length(24).optional().messages({
    "string.hex": "Package ID must be a valid hexadecimal string",
    "string.length": "Package ID must be exactly 24 characters long",
  }),

  logoBase64: Joi.string().optional().allow("").messages({
    "string.base": "Logo must be a valid base64 string",
  }),

  // ✅ الحقول الجديدة
  main_location: Joi.string().trim().allow("", null).optional(),
  branches_locations: Joi.array().items(Joi.string().trim()).optional(),
  branches_config: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().trim().allow("", null),
        Is_Online: Joi.boolean().default(false),
      }),
    )
    .optional(),
  payment_cycle: Joi.string()
    .valid("monthly", "quarterly", "half_yearly", "yearly")
    .optional()
    .messages({
      "any.only":
        "Payment cycle must be one of: monthly, quarterly, half_yearly, yearly",
    }),
  payment_amount: Joi.number().min(0).allow(null, "").optional(),
  contact_person_name: Joi.string().trim().allow("", null).optional(),
  contact_person_phone: Joi.string().trim().allow("", null).optional(),
  sales_man_name: Joi.string().trim().allow("", null).optional(),
  sales_man_phone: Joi.string().trim().allow("", null).optional(),
  subscription_end_date: Joi.date().allow(null, "").optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required to update",
  });

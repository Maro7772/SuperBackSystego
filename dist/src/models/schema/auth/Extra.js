"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtraModel = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const ExtraSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true },
    ar_name: { type: String },
    description: { type: String },
    ar_description: { type: String },
    // false = one-time add-on, true = recurring (charged every cycle)
    is_recurring: { type: Boolean, default: false },
}, { timestamps: true });
exports.ExtraModel = mongoose_1.default.model("Extra", ExtraSchema);

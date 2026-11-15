"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_item = exports.modify = exports.create = exports.getById = exports.view = void 0;
const Extra_1 = require("../../models/schema/auth/Extra");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
const view = async (req, res) => {
    const extras = await Extra_1.ExtraModel.find().sort({ createdAt: -1 });
    return (0, response_1.SuccessResponse)(res, { data: extras }, 200);
};
exports.view = view;
const getById = async (req, res) => {
    const id = req.params.id;
    const extra = await Extra_1.ExtraModel.findById(id);
    if (!extra) {
        throw new Errors_1.NotFound("Extra not found");
    }
    return (0, response_1.SuccessResponse)(res, { data: extra }, 200);
};
exports.getById = getById;
const create = async (req, res) => {
    const { name, ar_name, description, ar_description, is_recurring } = req.body;
    await Extra_1.ExtraModel.create({
        name,
        ar_name,
        description,
        ar_description,
        is_recurring: is_recurring ?? false,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Extra created successfully" }, 201);
};
exports.create = create;
const modify = async (req, res) => {
    const id = req.params.id;
    const extra = await Extra_1.ExtraModel.findById(id);
    if (!extra) {
        throw new Errors_1.NotFound("Extra not found");
    }
    const { name, ar_name, description, ar_description, is_recurring } = req.body;
    extra.name = name ?? extra.name;
    extra.ar_name = ar_name ?? extra.ar_name;
    extra.description = description ?? extra.description;
    extra.ar_description = ar_description ?? extra.ar_description;
    if (is_recurring !== undefined)
        extra.is_recurring = is_recurring;
    await extra.save();
    return (0, response_1.SuccessResponse)(res, { message: "Extra updated successfully" }, 200);
};
exports.modify = modify;
const delete_item = async (req, res) => {
    const id = req.params.id;
    const extra = await Extra_1.ExtraModel.findByIdAndDelete(id);
    if (!extra) {
        throw new Errors_1.NotFound("Extra not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Extra deleted successfully" }, 200);
};
exports.delete_item = delete_item;

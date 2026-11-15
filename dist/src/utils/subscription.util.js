"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSubscriptionPayload = exports.resolveSubscription = exports.calculateRemaining = exports.remainingFromEndDate = exports.extendSubscriptionEnd = exports.addCycleDays = exports.endOfDay = exports.cycleDays = void 0;
exports.cycleDays = {
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    yearly: 365,
};
const endOfDay = (value) => {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
};
exports.endOfDay = endOfDay;
const addCycleDays = (from, paymentCycle) => {
    const days = exports.cycleDays[paymentCycle || ""] ?? 30;
    const endDate = new Date(from);
    endDate.setDate(endDate.getDate() + days);
    return endDate;
};
exports.addCycleDays = addCycleDays;
const extendSubscriptionEnd = (currentEnd, paymentCycle) => {
    const now = new Date();
    const current = currentEnd ? new Date(currentEnd) : null;
    const base = current && current.getTime() > now.getTime() ? current : now;
    return (0, exports.addCycleDays)(base, paymentCycle);
};
exports.extendSubscriptionEnd = extendSubscriptionEnd;
const remainingFromEndDate = (endDate) => {
    if (!endDate) {
        return { daysLeft: null, endDate: null, expired: false };
    }
    const end = new Date(endDate);
    const diffMs = end.getTime() - Date.now();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
        daysLeft,
        endDate: end,
        expired: daysLeft <= 0,
    };
};
exports.remainingFromEndDate = remainingFromEndDate;
/**
 * حساب الأيام المتبقية في الاشتراك
 *
 * @param startDate - بداية الاشتراك (last payment date أو created_at)
 * @param paymentCycle - دورة الدفع (monthly, quarterly, ...)
 */
const calculateRemaining = (startDate, paymentCycle) => {
    if (!startDate || !paymentCycle) {
        return { daysLeft: null, endDate: null, expired: false };
    }
    const days = exports.cycleDays[paymentCycle];
    if (!days) {
        return { daysLeft: null, endDate: null, expired: false };
    }
    const start = new Date(startDate);
    const endDate = (0, exports.addCycleDays)(start, paymentCycle);
    return (0, exports.remainingFromEndDate)(endDate);
};
exports.calculateRemaining = calculateRemaining;
const resolveSubscription = (client, lastPaymentDate) => {
    if (client.subscription_end_date) {
        return (0, exports.remainingFromEndDate)(client.subscription_end_date);
    }
    const startDate = lastPaymentDate ||
        client.last_payment_date ||
        client.created_at ||
        client.createdAt;
    return (0, exports.calculateRemaining)(startDate, client.payment_cycle);
};
exports.resolveSubscription = resolveSubscription;
const buildSubscriptionPayload = (client, lastPayment) => {
    const lastPaymentDate = lastPayment?.date || null;
    const remaining = (0, exports.resolveSubscription)(client, lastPaymentDate);
    const startDate = lastPaymentDate ||
        client.last_payment_date ||
        client.created_at ||
        client.createdAt ||
        null;
    return {
        daysLeft: remaining.daysLeft,
        endDate: remaining.endDate,
        expired: remaining.expired,
        startDate,
        lastPaymentDate,
        isFirstCycle: !lastPayment,
        paymentCycle: client.payment_cycle || "monthly",
    };
};
exports.buildSubscriptionPayload = buildSubscriptionPayload;

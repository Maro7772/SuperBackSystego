export const cycleDays: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  yearly: 365,
};

export const endOfDay = (value: Date | string) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

export const addCycleDays = (
  from: Date | string,
  paymentCycle: string | null | undefined,
) => {
  const days = cycleDays[paymentCycle || ""] ?? 30;
  const endDate = new Date(from);
  endDate.setDate(endDate.getDate() + days);
  return endDate;
};

export const extendSubscriptionEnd = (
  currentEnd: Date | string | null | undefined,
  paymentCycle: string | null | undefined,
) => {
  const now = new Date();
  const current = currentEnd ? new Date(currentEnd) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addCycleDays(base, paymentCycle);
};

export const remainingFromEndDate = (
  endDate: Date | string | null | undefined,
) => {
  if (!endDate) {
    return { daysLeft: null as number | null, endDate: null as Date | null, expired: false };
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

/**
 * حساب الأيام المتبقية في الاشتراك
 *
 * @param startDate - بداية الاشتراك (last payment date أو created_at)
 * @param paymentCycle - دورة الدفع (monthly, quarterly, ...)
 */
export const calculateRemaining = (
  startDate: Date | string | null | undefined,
  paymentCycle: string | null | undefined,
) => {
  if (!startDate || !paymentCycle) {
    return { daysLeft: null, endDate: null, expired: false };
  }

  const days = cycleDays[paymentCycle];
  if (!days) {
    return { daysLeft: null, endDate: null, expired: false };
  }

  const start = new Date(startDate);
  const endDate = addCycleDays(start, paymentCycle);

  return remainingFromEndDate(endDate);
};

export const resolveSubscription = (client: {
  subscription_end_date?: Date | string | null;
  last_payment_date?: Date | string | null;
  created_at?: Date | string | null;
  createdAt?: Date | string | null;
  payment_cycle?: string | null;
}, lastPaymentDate?: Date | string | null) => {
  if (client.subscription_end_date) {
    return remainingFromEndDate(client.subscription_end_date);
  }

  const startDate =
    lastPaymentDate ||
    client.last_payment_date ||
    client.created_at ||
    client.createdAt;

  return calculateRemaining(startDate, client.payment_cycle);
};

export const buildSubscriptionPayload = (
  client: {
    subscription_end_date?: Date | string | null;
    last_payment_date?: Date | string | null;
    created_at?: Date | string | null;
    createdAt?: Date | string | null;
    payment_cycle?: string | null;
  },
  lastPayment?: { date?: Date | string | null } | null,
) => {
  const lastPaymentDate = lastPayment?.date || null;
  const remaining = resolveSubscription(client, lastPaymentDate);
  const startDate =
    lastPaymentDate ||
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

// Indian numbering format for currency
export const formatINR = (value, opts = {}) => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: opts.decimals ?? 0,
    maximumFractionDigits: opts.decimals ?? 0,
  });
  return `${n < 0 ? '-' : ''}₹${formatted}`;
};

export const formatCompactINR = (value) => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${n < 0 ? '-' : ''}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${n < 0 ? '-' : ''}₹${(abs / 100000).toFixed(2)} L`;
  if (abs >= 1000) return `${n < 0 ? '-' : ''}₹${(abs / 1000).toFixed(1)}K`;
  return formatINR(n);
};

export const formatDate = (iso) => {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

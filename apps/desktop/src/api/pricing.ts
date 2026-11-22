export function pricingUnknownMessage(reason: string) {
  return reason === 'price_incomplete'
    ? '手动单价不完整，请同时填写输入和输出单价'
    : '请设置明确的价格目录映射或手动输入单价';
}
export function formatUsd(units: string, unitsPerCurrency: string) {
  const scale = BigInt(unitsPerCurrency);
  const value = BigInt(units);
  const fraction = (value % scale).toString().padStart(unitsPerCurrency.length - 1, '0').replace(/0+$/, '');
  return `$${(value / scale).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

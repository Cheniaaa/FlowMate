const labels: Record<string, string> = {
  cache_read_at_input_rate: '缓存读取按输入单价计费',
  cache_write_at_input_rate: '缓存写入按输入单价计费',
  cache_write_1h_at_cache_write_rate: '1 小时缓存写入按缓存写入单价计费',
};
export default function PricingAssumptions({ assumptions }: { assumptions: string[] }) {
  return assumptions.length > 0 ? <ul>{assumptions.map(item => <li key={item}>{labels[item] ?? item}</li>)}</ul> : null;
}

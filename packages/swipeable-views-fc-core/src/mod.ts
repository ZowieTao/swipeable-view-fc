// Extended version of % with negative integer support.
function mod(n: number, m: number) {
  const q = n % m;
  return q < 0 ? q + m : q;
}

export default mod;

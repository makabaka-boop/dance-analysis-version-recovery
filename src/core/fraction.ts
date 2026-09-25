/**
 * 精确分数运算：分子 / 分母均为 BigInt，分母恒正，构造时约分。
 *
 * 坐标、时间、半径都是小整数，但两线段平方距离是时间的二次有理函数，
 * 最小值的分子（两个 ~10^13 量级整数之差）可能超过 Number.MAX_SAFE_INTEGER，
 * 因此全部走 BigInt，绝不用浮点近似。
 */
export class Fraction {
  readonly num: bigint
  readonly den: bigint // 恒 > 0

  constructor(num: bigint | number | string, den: bigint | number | string = 1n) {
    const n = BigInt(num)
    const d = BigInt(den)
    if (d === 0n) throw new Error('Fraction: zero denominator')
    const g = gcd(n < 0n ? -n : n, d)
    const sign = d < 0n ? -1n : 1n
    this.num = sign === -1n ? -n / g : n / g
    this.den = (sign === -1n ? -d : d) / g
  }

  static ZERO = new Fraction(0n)
  static ONE = new Fraction(1n)

  add(o: Fraction): Fraction {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den)
  }

  sub(o: Fraction): Fraction {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den)
  }

  mul(o: Fraction): Fraction {
    return new Fraction(this.num * o.num, this.den * o.den)
  }

  div(o: Fraction): Fraction {
    if (o.num === 0n) throw new Error('Fraction: division by zero')
    return new Fraction(this.num * o.den, this.den * o.num)
  }

  neg(): Fraction {
    return new Fraction(-this.num, this.den)
  }

  /** 分子绝对值 / 分母（用于比较平方距离，免做完整乘法） */
  private absCmp(o: Fraction): number {
    const a = (this.num < 0n ? -this.num : this.num) * o.den
    const b = (o.num < 0n ? -o.num : o.num) * this.den
    return a < b ? -1 : a > b ? 1 : 0
  }

  compareAbs(o: Fraction): number {
    return this.absCmp(o)
  }

  compareTo(o: Fraction): number {
    const lhs = this.num * o.den
    const rhs = o.num * this.den
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0
  }

  lt(o: Fraction): boolean {
    return this.compareTo(o) < 0
  }
  le(o: Fraction): boolean {
    return this.compareTo(o) <= 0
  }
  gt(o: Fraction): boolean {
    return this.compareTo(o) > 0
  }
  ge(o: Fraction): boolean {
    return this.compareTo(o) >= 0
  }
  eq(o: Fraction): boolean {
    return this.compareTo(o) === 0
  }

  isZero(): boolean {
    return this.num === 0n
  }
  isPositive(): boolean {
    return this.num > 0n
  }

  /** 仅用于展示 / 滑块 / SVG 定位，几何判断不使用它 */
  toNumber(): number {
    return Number(this.num) / Number(this.den)
  }

  /** 十进制近似字符串，截断（非四舍五入）到 decimals 位小数 */
  toFixedTrunc(decimals = 4): string {
    const neg = this.num < 0n
    const n = neg ? -this.num : this.num
    const scale = 10n ** BigInt(decimals)
    const whole = n / this.den
    const frac = ((n % this.den) * scale) / this.den
    const pad = frac.toString().padStart(decimals, '0')
    return `${neg ? '-' : ''}${whole}.${pad}`
  }

  /** 精确分数形式 "p/q"，分母为 1 时省略 "/q" */
  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`
  }

  toJSON(): { num: string; den: string } {
    return { num: this.num.toString(), den: this.den.toString() }
  }

  static fromJSON(d: { num: string; den: string }): Fraction {
    return new Fraction(BigInt(d.num), BigInt(d.den))
  }
}

export function frac(num: bigint | number, den: bigint | number = 1n): Fraction {
  return new Fraction(num, den)
}

export function minFrac(a: Fraction, b: Fraction): Fraction {
  return a.lt(b) ? a : b
}

export function maxFrac(a: Fraction, b: Fraction): Fraction {
  return a.gt(b) ? a : b
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const r = x % y
    x = y
    y = r
  }
  return x
}

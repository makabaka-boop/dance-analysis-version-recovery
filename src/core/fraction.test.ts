import { describe, expect, it } from 'vitest'
import { Fraction, frac, gcd } from './fraction'

describe('Fraction 精确分数', () => {
  it('构造时约分并规整分母符号', () => {
    expect(new Fraction(4, -6).toString()).toBe('-2/3')
    expect(new Fraction(-4, -6).toString()).toBe('2/3')
    expect(new Fraction(0, -9).toString()).toBe('0')
    expect(gcd(0n, 7n)).toBe(7n)
  })

  it('四则运算', () => {
    expect(frac(1, 2).add(frac(1, 3)).toString()).toBe('5/6')
    expect(frac(1, 2).sub(frac(2, 3)).toString()).toBe('-1/6')
    expect(frac(3, 4).mul(frac(8, 9)).toString()).toBe('2/3')
    expect(frac(3, 4).div(frac(9, 8)).toString()).toBe('2/3')
    expect(frac(-3, 4).neg().toString()).toBe('3/4')
  })

  it('比较与边界 ≤ / ≥', () => {
    expect(frac(2, 3).lt(frac(3, 4))).toBe(true)
    expect(frac(4, 6).eq(frac(2, 3))).toBe(true)
    expect(frac(5).ge(frac(10, 2))).toBe(true)
    expect(frac(-5).lt(frac(0))).toBe(true)
    expect(new Fraction(-1, 2).compareTo(new Fraction(1, -2))).toBe(0)
  })

  it('BigInt 精度：超过 Number.MAX_SAFE_INTEGER 的整数精确比较', () => {
    const big1 = new Fraction('9007199254740993') // 2^53+1，无法用 double 精确表示
    const big2 = new Fraction('9007199254740992') // 2^53
    expect(big1.sub(big2).toString()).toBe('1')
    expect(big1.gt(big2)).toBe(true)
  })

  it('JSON 往返保持精确', () => {
    const f = new Fraction(-123456789012345678n, 987654321n)
    const back = Fraction.fromJSON(f.toJSON())
    expect(back.eq(f)).toBe(true)
  })

  it('toFixedTrunc 是截断而非四舍五入（仅展示用）', () => {
    expect(frac(2, 3).toFixedTrunc(4)).toBe('0.6666')
    expect(frac(-2, 3).toFixedTrunc(2)).toBe('-0.66')
  })

  it('零分母与除零抛错', () => {
    expect(() => new Fraction(1, 0)).toThrow()
    expect(() => frac(1).div(Fraction.ZERO)).toThrow()
  })
})

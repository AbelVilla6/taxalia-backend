export class ColdStartGate {
  private cold = true;

  constructor(private readonly coldBudgetMs: number = 60_000) {}

  isCold(): boolean {
    return this.cold;
  }

  takeColdBudgetMs(): number | null {
    if (!this.cold) return null;
    this.cold = false;
    return this.coldBudgetMs;
  }
}

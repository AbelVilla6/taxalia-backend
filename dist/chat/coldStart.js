export class ColdStartGate {
    coldBudgetMs;
    cold = true;
    constructor(coldBudgetMs = 60_000) {
        this.coldBudgetMs = coldBudgetMs;
    }
    isCold() {
        return this.cold;
    }
    takeColdBudgetMs() {
        if (!this.cold)
            return null;
        this.cold = false;
        return this.coldBudgetMs;
    }
}

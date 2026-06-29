// Fixture for parameter-schema derivation tests. Read from disk by the TS
// compiler API; never imported.
export class Sample {
  gen(min: number, max: number): number {
    return min + max;
  }

  greet(name: string, loud?: boolean): string {
    return loud ? `${name}!` : name;
  }

  pick(choice: "a" | "b" | "c"): string {
    return choice;
  }

  sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
  }

  configure(options: { id: string; count: number }): void {
    JSON.stringify(options);
  }
}

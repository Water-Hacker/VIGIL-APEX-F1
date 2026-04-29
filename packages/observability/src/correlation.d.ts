export declare function withCorrelation<T>(correlationId: string, worker: string | undefined, fn: () => Promise<T> | T): Promise<T> | T;
export declare function getCorrelationId(): string | undefined;
export declare function getWorkerName(): string | undefined;
export declare function newCorrelationId(): string;
//# sourceMappingURL=correlation.d.ts.map
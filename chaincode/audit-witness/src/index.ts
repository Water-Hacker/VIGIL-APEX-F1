import { AuditWitnessContract } from './contract.js';

export { AuditWitnessContract };

// fabric-chaincode-node entry — exports the contract list it should expose.
export const contracts: typeof AuditWitnessContract[] = [AuditWitnessContract];

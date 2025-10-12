import { CommitmentAdded as CommitmentAddedEvent } from "../generated/ZWToken/ZWToken";
import { Commitment } from "../generated/schema";

export function handleCommitmentAdded(event: CommitmentAddedEvent): void {
  // Create Commitment entity
  let entity = new Commitment(event.params.commitment.toHexString());
  entity.commitment = event.params.commitment;
  entity.index = event.params.index;
  entity.recipient = event.params.recipient;
  entity.amount = event.params.amount;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
}

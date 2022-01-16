import { BigNumber } from 'bignumber.js';
import {
  ContractMethod,
  ContractProvider,
  MichelsonMap
} from '@taquito/taquito';
import { char2Bytes } from '@taquito/utils';

import {
  Tzip12Contract,
  address,
  TokenMetadataInternal,
  bytes
} from '@oxheadalpha/fa2-interfaces';

export interface MintParam {
  owner: address;
  tokens: TokenMetadataInternal[];
}

export interface NftContract {
  mintTokens: (tokens: MintParam[]) => ContractMethod<ContractProvider>;
  freezeCollection: () => ContractMethod<ContractProvider>;
  addMinter: (minter: address) => ContractMethod<ContractProvider>;
  removeMinter: (minter: address) => ContractMethod<ContractProvider>;
}

export const Nft = (contract: Tzip12Contract): NftContract => ({
  mintTokens: tokens => contract.methods.mint(tokens),
  freezeCollection: () => contract.methods.mint_freeze(),
  addMinter: minter => contract.methods.add_minter(minter),
  removeMinter: minter => contract.methods.remove_minter(minter)
});

export function createNftStorage(owner: string, metaJson: string) {
  const assets = {
    ledger: new MichelsonMap(),
    operators: new MichelsonMap(),
    token_metadata: new MichelsonMap()
  };
  const admin = {
    admin: owner,
    pending_admin: undefined,
    paused: false
  };
  const minter = new MichelsonMap();
  const metadata = new MichelsonMap<string, bytes>();
  metadata.set('', char2Bytes('tezos-storage:content'));
  metadata.set('content', char2Bytes(metaJson));

  return {
    assets,
    admin,
    minter,
    metadata,
    mint_freeze: false
  };
}

export function createTokenMetadata(
  tokenId: string | number,
  tokenMetadataUri: string
): TokenMetadataInternal {
  const m: TokenMetadataInternal = {
    token_id: new BigNumber(tokenId),
    token_info: new MichelsonMap()
  };
  m.token_info.set('', char2Bytes(tokenMetadataUri));
  return m;
}

import Conf from 'conf';
import * as kleur from 'kleur';
import * as fs from 'fs';
import * as path from 'path';
import { BigNumber } from 'bignumber.js';
import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import {
  getActiveNetworkCfg,
  getInspectorKey,
  loadUserConfig,
  loadFile
} from './config-util';
import { resolveAlias2Signer, resolveAlias2Address } from './config-aliases';

export interface Fa2TransferDestination {
  to_: string;
  token_id: BigNumber;
  amount: BigNumber;
}

export interface Fa2Transfer {
  from_: string;
  txs: Fa2TransferDestination[];
}

export interface BalanceOfRequest {
  owner: string;
  token_id: BigNumber;
}

export interface BalanceOfResponse {
  balance: BigNumber;
  request: BalanceOfRequest;
}

type InspectorStorage = BalanceOfResponse[] | {};

interface TokenMetadata {
  token_id: BigNumber;
  symbol: string;
  name: string;
  decimals: BigNumber;
  extras: MichelsonMap<string, string>;
}

export function createToolkit(
  signer: InMemorySigner,
  config: Conf<Record<string, string>>
): TezosToolkit {
  const { network, configKey } = getActiveNetworkCfg(config);
  const providerUrl = config.get(`${configKey}.providerUrl`);
  if (!providerUrl) {
    const msg = `network provider for ${kleur.yellow(
      network
    )} URL is not configured`;
    console.log(kleur.red(msg));
    throw new Error(msg);
  }

  const toolkit = new TezosToolkit();
  toolkit.setProvider({
    signer,
    rpc: providerUrl,
    config: { confirmationPollingIntervalSecond: 5 }
  });
  return toolkit;
}

export async function testNode() {
  try {
    console.log('NODDING');

    const signer = await InMemorySigner.fromFundraiser(
      'zpbvthys.zrhzykdu@tezos.example.org',
      'MDibu76MwG',
      'smooth series steel before firm security clog puppy hard spice cotton pizza rent whip crane'
    );

    const toolkit = new TezosToolkit();
    toolkit.setProvider({
      rpc: 'https://testnet-tezos.giganode.io',
      signer
    });

    const secretKey = await toolkit.signer.secretKey();
    console.log('SECRET', secretKey);

    // console.log('ACTIVATING');
    // const aop = await toolkit.tz.activate(
    //   'tz1f6LtT8nER9aYaaNb7PPJq7rkhwpcXexU6',
    //   'd7f3fa4d7ba43804b0eb9725d6c4543c94107bc5'
    // );
    // await aop.confirmation();

    console.log('BALANCING');
    const bal = await toolkit.tz.getBalance(
      'tz1f6LtT8nER9aYaaNb7PPJq7rkhwpcXexU6'
    );
    console.log('FAUCET BAL ' + bal);
  } catch (err) {
    console.log(JSON.stringify(err));
  }
}

export async function originateInspector(tezos: TezosToolkit): Promise<string> {
  const code = await loadFile(path.join(__dirname, '../ligo/out/inspector.tz'));
  const storage = `(Left Unit)`;
  return originateContract(tezos, code, storage, 'inspector');
}

export async function mintNfts(
  owner: string,
  tokens: TokenMetadata[]
): Promise<void> {
  const config = loadUserConfig();
  const signer = await resolveAlias2Signer(owner, config);
  const ownerAddress = await signer.publicKeyHash();
  const tz = createToolkit(signer, config);

  const code = await loadFile(
    path.join(__dirname, '../ligo/out/fa2_fixed_collection_token.tz')
  );
  const storage = createNftStorage(tokens, ownerAddress);

  console.log(kleur.yellow('originating new NFT contract'));
  const nftAddress = await originateContract(tz, code, storage, 'nft');
  console.log(
    kleur.yellow(`originated NFT collection ${kleur.green(nftAddress)}`)
  );
}

export function parseTokens(
  descriptor: string,
  tokens: TokenMetadata[]
): TokenMetadata[] {
  const [id, symbol, name] = descriptor.split(',').map(p => p.trim());
  const token: TokenMetadata = {
    token_id: new BigNumber(id),
    symbol,
    name,
    decimals: new BigNumber(0),
    extras: new MichelsonMap()
  };
  return [token].concat(tokens);
}

function createNftStorage(tokens: TokenMetadata[], owner: string) {
  const ledger = new MichelsonMap<BigNumber, string>();
  const token_metadata = new MichelsonMap<BigNumber, TokenMetadata>();
  for (let meta of tokens) {
    ledger.set(meta.token_id, owner);
    token_metadata.set(meta.token_id, meta);
  }
  return {
    ledger,
    operators: new MichelsonMap(),
    token_metadata
  };
}

export async function getBalances(
  operator: string,
  nft: string,
  owner: string,
  tokens: string[]
): Promise<void> {
  const config = loadUserConfig();

  const signer = await resolveAlias2Signer(operator, config);
  const operatorAddress = await signer.publicKeyHash();
  const tz = createToolkit(signer, config);

  const ownerAddress = await resolveAlias2Address(owner, config);

  const requests: BalanceOfRequest[] = tokens.map(t => {
    return { token_id: new BigNumber(t), owner: ownerAddress };
  });

  const inspectorKey = getInspectorKey(config);
  const inspectorAddress = config.get(inspectorKey);
  if (!inspectorAddress) {
    console.log(
      kleur.red(
        'Cannot find deployed balance inspector contract.\nTry to kill and start network again.'
      )
    );
    return;
  }

  console.log(
    kleur.yellow(
      `querying NFT contract ${kleur.green(
        nft
      )} over balance inspector ${kleur.green(inspectorAddress)}`
    )
  );
  const inspector = await tz.contract.at(inspectorAddress);
  const balanceOp = await inspector.methods.query(nft, requests).send();
  await balanceOp.confirmation();
  const storage = await inspector.storage<InspectorStorage>();
  if (Array.isArray(storage)) printBalances(storage);
  else {
    console.log(kleur.red('invalid inspector storage state'));
    return Promise.reject('Invalid inspector storage state Empty.');
  }
}

function printBalances(balances: BalanceOfResponse[]): void {
  console.log(kleur.green('requested NFT balances:'));
  for (let b of balances) {
    console.log(
      kleur.yellow(
        `owner: ${kleur.green(b.request.owner)}\ttoken: ${kleur.green(
          b.request.token_id.toString()
        )}\tbalance: ${kleur.green(b.balance.toString())}`
      )
    );
  }
}

export function parseTransfers(
  description: string,
  transfers: Fa2Transfer[]
): Fa2Transfer[] {
  const [from_, to_, token_id] = description.split(',').map(p => p.trim());
  const tx: Fa2Transfer = {
    from_,
    txs: [
      {
        to_,
        token_id: new BigNumber(token_id),
        amount: new BigNumber(1)
      }
    ]
  };
  if (transfers.length > 0 && transfers[0].from_ === from_) {
    //merge last two transfers
    transfers[0].txs = transfers[0].txs.concat(tx.txs);
    return transfers;
  }

  return [tx].concat(transfers);
}

export async function transfer(
  operator: string,
  nft: string,
  tokens: Fa2Transfer[]
): Promise<void> {
  const config = loadUserConfig();
  const txs = await resolveTxAddresses(tokens, config);
  // console.log('RESOLVED ' + JSON.stringify(txs));
  const signer = await resolveAlias2Signer(operator, config);
  const operatorAddress = await signer.publicKeyHash();
  const tz = createToolkit(signer, config);

  console.log(kleur.yellow('transferring tokens...'));
  const nftContract = await tz.contract.at(nft);
  const txOp = await nftContract.methods.transfer(txs).send();
  await txOp.confirmation();
  console.log(kleur.green('tokens transferred'));
}

async function resolveTxAddresses(
  tokens: Fa2Transfer[],
  config: Conf<Record<string, string>>
): Promise<Fa2Transfer[]> {
  return Promise.all(
    tokens.map(async t => {
      return {
        from_: await resolveAlias2Address(t.from_, config),
        txs: await resolveTxDestinationAddresses(t.txs, config)
      };
    })
  );
}

async function resolveTxDestinationAddresses(
  txs: Fa2TransferDestination[],
  config: Conf<Record<string, string>>
): Promise<Fa2TransferDestination[]> {
  return Promise.all(
    txs.map(async t => {
      return {
        to_: await resolveAlias2Address(t.to_, config),
        amount: t.amount,
        token_id: t.token_id
      };
    })
  );
}

async function originateContract(
  tz: TezosToolkit,
  code: string,
  storage: string | object,
  name: string
): Promise<string> {
  const origParam =
    typeof storage === 'string' ? { code, init: storage } : { code, storage };
  try {
    const originationOp = await tz.contract.originate(origParam);

    const contract = await originationOp.contract();
    return contract.address;
  } catch (error) {
    const jsonError = JSON.stringify(error, null, 2);
    console.log(kleur.red(`${name} origination error ${jsonError}`));
    return Promise.reject(jsonError);
  }
}

import 'dotenv/config';

function opt(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

// Treat placeholder values as unset
function key(envKey: string): string {
  const v = opt(envKey, '');
  return v === '0x...' || v === 'kh_...' ? '' : v;
}

export const config = {
  privateKey:        key('PRIVATE_KEY'),
  mainnetRpc:        opt('MAINNET_RPC_URL', 'https://cloudflare-eth.com'),
  sepoliaRpc:        opt('SEPOLIA_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com'),
  ogIndexerUrl:      opt('OG_INDEXER_URL', 'https://indexer-storage-testnet-turbo.0g.ai'),
  ogRpcUrl:          opt('OG_RPC_URL', 'https://evmrpc-testnet.0g.ai'),
  axlApiUrl:         opt('AXL_API_URL', 'http://127.0.0.1:9002'),
  keeperHubApiKey:   key('KEEPERHUB_API_KEY'),
  keeperHubApiUrl:   opt('KEEPERHUB_API_URL', 'https://app.keeperhub.com/api'),
  ensScoutName:      opt('ENS_SCOUT_NAME', 'scout.0xgoldengoose.eth'),
  ensRiskName:       opt('ENS_RISK_NAME', 'risk.0xgoldengoose.eth'),
  ensExecutorName:   opt('ENS_EXECUTOR_NAME', 'executor.0xgoldengoose.eth'),
  tokenIn:           opt('TOKEN_IN', 'WETH'),
  tokenOut:          opt('TOKEN_OUT', 'USDC'),
  poolFee:           parseInt(opt('POOL_FEE', '500')),
  tradeAmountWei:    BigInt(opt('TRADE_AMOUNT_WEI', '100000000000000000')),
  buyThresholdPct:   parseFloat(opt('BUY_THRESHOLD_PCT', '1.5')),
  sellThresholdPct:  parseFloat(opt('SELL_THRESHOLD_PCT', '1.5')),
  maxSlippagePct:    parseFloat(opt('MAX_SLIPPAGE_PCT', '0.5')),
  scoutPollMs:       parseInt(opt('SCOUT_POLL_MS', '15000')),
} as const;

export const TOKENS = {
  mainnet: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`,
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as `0x${string}`,
    DAI:  '0x6B175474E89094C44Da98b954EedeAC495271d0F' as `0x${string}`,
  },
  sepolia: {
    WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as `0x${string}`,
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`,
  },
} as const;

export const UNISWAP = {
  mainnet: {
    quoterV2:     '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as `0x${string}`,
    swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as `0x${string}`,
    factory:      '0x1F98431c8aD98523631AE4a59f267346ea31F984' as `0x${string}`,
  },
  sepolia: {
    quoterV2:     '0xEd1f6473345F45b75833fd55D5ADbEd9Bae0344' as `0x${string}`,
    swapRouter02: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48' as `0x${string}`,
    factory:      '0x0227628f3F023bb0B980b67D528571c95c6DaC1' as `0x${string}`,
  },
} as const;

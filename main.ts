import dotenv from "dotenv";
import readline from "readline";
import {
  Address,
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

// SDK imports

import { GmxSdk } from "@gmx-io/sdk";
import { USD_DECIMALS } from "@gmx-io/sdk/configs/factors.js";
import { MarketsInfoData } from "@gmx-io/sdk/types/markets.js";
import {
  DecreasePositionSwapType,
  OrderType,
} from "@gmx-io/sdk/types/orders.js";
import { Position } from "@gmx-io/sdk/types/positions.js";
import { TokensData } from "@gmx-io/sdk/types/tokens.js";
import { bigMath } from "@gmx-io/sdk/utils/bigmath.js";
import { getMarkPrice } from "@gmx-io/sdk/utils/prices.js";
import {
  convertToUsd,
  getIsEquivalentTokens,
} from "@gmx-io/sdk/utils/tokens.js";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error(
    "PRIVATE_KEY is not set in environment variables. Try setting PRIVATE_KEY in .env file."
  );
}

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as any);

const walletClient = createWalletClient({
  transport: http(undefined, {
    timeout: 60000,
    batch: {
      wait: 200,
      batchSize: 1000,
    },
  }),
  account: account,
  chain: avalancheFuji,
});

const publicClient = createPublicClient({
  chain: avalancheFuji,
  batch: {
    multicall: {
      wait: 200,
      batchSize: 1024 * 1024,
    },
  },
  transport: http(undefined, {
    timeout: 60000,
    batch: {
      wait: 200,
      batchSize: 1000,
    },
  }),
});

const sdk = new GmxSdk({
  account: account.address,
  chainId: avalancheFuji.id,
  rpcUrl: avalancheFuji.rpcUrls.default.http[0],
  oracleUrl: "https://synthetics-api-avax-fuji-upovm.ondigitalocean.app",
  walletClient: walletClient,
  publicClient: publicClient,
  subsquidUrl: "https://gmx.squids.live/gmx-synthetics-fuji:live/api/graphql",
  subgraphUrl:
    "https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-fuji-stats/api",
});

async function createNewStopLossOrder({
  sdk,
  marketsInfoData,
  tokensData,
  position,
}: {
  sdk: GmxSdk;
  marketsInfoData: MarketsInfoData;
  tokensData: TokensData;
  position: Position;
}) {
  const marketInfo = marketsInfoData[position.marketAddress];
  if (!marketInfo || !tokensData) return;

  const price = getMarkPrice({
    prices: marketInfo.longToken.prices,
    isIncrease: false,
    isLong: position.isLong,
  });

  const stopLossPrice = position.isLong
    ? bigMath.mulDiv(price, 90n, 100n)
    : bigMath.mulDiv(price, 110n, 100n);

  console.log(formatUnits(stopLossPrice, USD_DECIMALS));

  const collateralPrice = getIsEquivalentTokens(
    marketInfo.indexToken,
    tokensData[position.collateralTokenAddress]
  )
    ? stopLossPrice ?? price
    : tokensData[position.collateralTokenAddress].prices.minPrice;

  const estimatedCollateralUsd = convertToUsd(
    position.collateralAmount,
    tokensData[position.collateralTokenAddress].decimals,
    collateralPrice
  )!;

  //   really needed fields

  // swapPath: string[];
  // receiveTokenAddress: string;
  // sizeDeltaUsd: bigint;
  // sizeDeltaInTokens: bigint;
  // acceptablePrice: bigint;
  // triggerPrice: bigint | undefined;
  // minOutputUsd: bigint;
  // isLong: boolean;
  // decreasePositionSwapType: DecreasePositionSwapType;
  // orderType: OrderType.MarketDecrease | OrderType.LimitDecrease | OrderType.StopLossDecrease;
  // executionFee: bigint;
  // allowedSlippage: number;
  // skipSimulation?: boolean;
  // referralCode?: string;
  // indexToken: Token;
  // tokensData: TokensData;
  // autoCancel: boolean;

  const stopLossOrder = await sdk.orders.createDecreaseOrder({
    allowedSlippage: 50,
    collateralToken: tokensData[position.collateralTokenAddress],
    marketInfo,
    marketsInfoData,
    decreaseAmounts: {
      isFullClose: true,
      sizeDeltaUsd: position.sizeInUsd,
      sizeDeltaInTokens: position.sizeInTokens,
      collateralDeltaUsd: estimatedCollateralUsd,
      collateralDeltaAmount: position.collateralAmount,
      indexPrice: 0n,
      collateralPrice: 0n,
      triggerPrice: stopLossPrice,
      acceptablePrice: stopLossPrice,
      acceptablePriceDeltaBps: 0n,
      recommendedAcceptablePriceDeltaBps: 0n,
      estimatedPnl: 0n,
      estimatedPnlPercentage: 0n,
      realizedPnl: 0n,
      realizedPnlPercentage: 0n,
      positionFeeUsd: 0n,
      uiFeeUsd: 0n,
      swapUiFeeUsd: 0n,
      feeDiscountUsd: 0n,
      borrowingFeeUsd: 0n,
      fundingFeeUsd: 0n,
      swapProfitFeeUsd: 0n,
      positionPriceImpactDeltaUsd: 0n,
      priceImpactDiffUsd: 0n,
      payedRemainingCollateralAmount: 0n,
      payedOutputUsd: 0n,
      payedRemainingCollateralUsd: 0n,
      receiveTokenAmount: 0n,
      receiveUsd: 0n,
      decreaseSwapType: DecreasePositionSwapType.NoSwap,
      triggerOrderType: OrderType.StopLossDecrease,
      // triggerThresholdType
    },
    isLong: position.isLong,
    tokensData,
  });
}

async function main() {
  const { marketsInfoData, tokensData, pricesUpdatedAt } =
    await sdk.markets.getMarketsInfo();

  if (!marketsInfoData || !tokensData) return;

  const positions = await sdk.positions.getPositions({
    marketsInfoData: marketsInfoData,
    tokensData: tokensData,
  });

  const formatPosition = (position: Position) => {
    const marketInfo = marketsInfoData?.[position.marketAddress];
    if (!marketInfo || !tokensData) return "";
    const marketName = marketInfo.name || "";
    const isLong = position.isLong ? "Long" : "Short";

    const sizeInUsd = formatUnits(position.sizeInUsd, USD_DECIMALS);
    const collateralTokenName =
      tokensData?.[position.collateralTokenAddress].name;
    const price = getMarkPrice({
      prices: marketInfo.longToken.prices,
      isIncrease: false,
      isLong: position.isLong,
    });
    const formattedPrice = formatUnits(price, USD_DECIMALS);

    return `${marketName} ${isLong} ${sizeInUsd} ${collateralTokenName} ${formattedPrice}`;
  };

  //   for (const position of Object.values(positions.positionsData || {})) {
  //     console.log(, formatPosition(position));
  //   }
  const positionsArray = Object.values(positions.positionsData || {});
  for (let index = 0; index < positionsArray.length; index++) {
    const position = positionsArray[index];
    console.log(index, formatPosition(position));
  }

  //   wait for user input

  const selectedPositionIndex = await new Promise<number>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Enter position index: ", (answer) => {
      resolve(parseInt(answer));
    });
  });

  const selectedPosition = positionsArray[selectedPositionIndex];

  if (!selectedPosition) return;

  // check if position already has a stop loss

  const ordersResult = await sdk.orders.getOrders({
    marketsInfoData,
    tokensData,
    marketsDirectionsFilter: [
      {
        direction: selectedPosition.isLong ? "long" : "short",
        marketAddress: selectedPosition.marketAddress as Address,
        collateralAddress: selectedPosition.collateralTokenAddress as Address,
      },
    ],
    orderTypesFilter: [OrderType.StopLossDecrease],
  });

  if (ordersResult.count > 0) {
    console.log("Position already has a stop loss. Continuing...");

    const firstOrder = Object.values(ordersResult.ordersInfoData)[0];

    const updatedAtMs = Number(firstOrder.updatedAtTime) * 1000;
    const nowMs = Date.now();

    // if it was updated in the last 2 minutes, don't edit it
    if (nowMs - updatedAtMs < 2 * 60 * 1000) {
      console.log(
        "Existing stop loss is too recent. It was updated ~",
        Math.round((nowMs - updatedAtMs) / 1000 / 60),
        "minutes ago. Skipping..."
      );
      return;
    }

    // if the trigger price is withing 5% of current nessessasry pricee (10% less than market for long, 10% more than market for short)
    // don't edit it

    const indexTokenDecimals =
      marketsInfoData[selectedPosition.marketAddress].indexToken.decimals;
    const existingTriggerPrice =
      firstOrder.contractTriggerPrice * 10n ** BigInt(indexTokenDecimals);
    console.log(
      "Existing trigger price",
      formatUnits(existingTriggerPrice, USD_DECIMALS)
    );

    const currentPrice = getMarkPrice({
      prices: marketsInfoData[selectedPosition.marketAddress].longToken.prices,
      isIncrease: false,
      isLong: selectedPosition.isLong,
    });

    const necessaryTriggerPrice = selectedPosition.isLong
      ? bigMath.mulDiv(currentPrice, 90n, 100n)
      : bigMath.mulDiv(currentPrice, 110n, 100n);

    console.log(
      "Necessary trigger price",
      formatUnits(necessaryTriggerPrice, USD_DECIMALS)
    );

    if (
      bigMath.abs(existingTriggerPrice - necessaryTriggerPrice) <
      bigMath.mulDiv(currentPrice, 1_00n, 100_00n)
    ) {
      console.log(
        "Trigger price is within 1% of necessary trigger price. Skipping..."
      );
      return;
    }

    const existingOrderKey = firstOrder.key;

    // cancel the existing order

    await Promise.all([
      sdk.orders.cancelOrders([existingOrderKey]),
      createNewStopLossOrder({
        sdk,
        marketsInfoData,
        tokensData,
        position: selectedPosition,
      }),
    ]);

    return;
  }

  // create a stop loss when price is 10% different from the current price. lower for long, higher for short.

  createNewStopLossOrder({
    sdk,
    marketsInfoData,
    tokensData,
    position: selectedPosition,
  });
}

main();

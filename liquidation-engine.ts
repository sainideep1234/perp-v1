import { createLongMarketOrder, createShortMarketOrder, createUserOrder, user } from ".";
import type { Kind, MARKET, Order, OrderType, Type } from "./store/types";



function PlaceMarketOrder(userId: string, market: MARKET, type: Type, margin: number, kind: Kind, qty: number) {
    const orderPlacingSide = type === "LONG" ? "SHORT" : "LONG";
    const currentOrderDetails: Order = {
        orderId: crypto.randomUUID(),
        market,
        type: orderPlacingSide,
        margin,
        kind,
        status: "PENDING",
        qty
    }
    createUserOrder(userId, currentOrderDetails)


    if (orderPlacingSide === "LONG") {
        //   place long order
        createLongMarketOrder(userId, currentOrderDetails)
        return
    }

    // place short order 
    createShortMarketOrder(userId, currentOrderDetails)
    return
}

export function calculateLiquidation(markPriceMarket: number, market: MARKET) {
    const positionToLiquidate = Object.keys(user).map((userId) => {
        user[userId]?.positions.forEach((pos) => {
            if (pos.market === market) {
                let leverage = (pos.averagePrice * pos.qty) / pos.margin;
                let pnl: number;
                // profit is in positive and loss is in -ve
                if (pos.type === "LONG") {
                    pnl = (markPriceMarket - pos.averagePrice) * pos.qty;
                } else {
                    pnl = (pos.averagePrice - markPriceMarket) * pos.qty;
                }
                let liquidationPrice: number = 0;

                if (pnl < 0) {
                    liquidationPrice = pos.margin - (pos.margin * 0.05) - pnl;
                } else {
                    liquidationPrice = pos.margin - (pos.margin * 0.05);
                }
                pos.liquidationPrice = liquidationPrice;
                if (liquidationPrice === 0) {
                    // place market order 
                    PlaceMarketOrder(userId, pos.market, pos.type, pos.margin, "MARKET", pos.qty);

                }
            }
        })
    })
}


import express, { type NextFunction, type Request, type Response } from "express";
import type { Bid, Collateral, Fill, FillInfo, MARKET, Order, Orderbook, Orderbooks, OrderType, Status, Type, User } from "./store/types";
import { OrderedMap } from "js-sdsl";
import { startListeningToBinanceForMarkPrice } from "./BinanceMarkPrice";

const app = express();
export const orderbook: Orderbooks = {}
export const user: User = {}
export const MAX_LEVERAGE = 10;

startListeningToBinanceForMarkPrice();


/*
{
    qty:10, 
    market:"SOL", 
    kind:"LIMIT", 
    price:100, 
    type:"LONG", 
    equity:500
}

{
    qty:10, 
    market:"SOL", 
    kind:"MARKET", 
    type:"LONG", 
    equity:500
}

on above levrage calculated as 10 * 100 = 1000/ 500 = 2x 
*/

function calculateAveragePrice(fillInfo: FillInfo[]) {
    const totalAvailable = fillInfo.reduce((acc, curr) => {
        acc.totalPrice += curr.qty * curr.price;
        acc.totalQty += curr.qty
        return acc
    }, { totalQty: 0, totalPrice: 0 })

    return {
        averagePrice: totalAvailable.totalPrice / totalAvailable.totalQty,
        filledQty: totalAvailable.totalQty
    }
}


function changePosition(userId: string, market: MARKET, type: Type, qty: number, margin: number, liquidationPrice: number, averagePrice: number) {
    const userAvailabel = user[userId];
    const positionDetail = {
        market,
        type,
        qty,
        margin,
        liquidationPrice,
        averagePrice
    }
    const position = userAvailabel?.positions.find((pos) => pos.market === market && pos.type ===
        type)

    if (!position) {
        userAvailabel!.positions.push(positionDetail)
        return;
    }

    position.averagePrice += averagePrice
    position.averagePrice /= 2;
    position.qty += qty
}

function changeOrderStatus(userId: string, status: Status, orderId: string) {
    const userAvailabel = user[userId];
    const getOrder = userAvailabel?.orders.find((order) => {
        return order.orderId === orderId
    })
    if (getOrder) {
        getOrder?.status === status
    }
}

function createLongLimitOrder(userId: string, currentOrder: Order) {
    const shortSide = getOppositeSide(currentOrder.market, "LONG");
    const fillInfo: FillInfo[] = []
    let remainingQty = currentOrder.qty;

    if (shortSide.front()) {
        const [bestPrice, PriceLevelOrder] = shortSide.front()!
        while (shortSide.front() && remainingQty > 0) {
            if (bestPrice <= currentOrder.price!) {
                if (PriceLevelOrder.availableQty >= currentOrder.qty) {
                    while (remainingQty > 0 && PriceLevelOrder.openOrders.length !== 0) {
                        let topOpenOrder = PriceLevelOrder.openOrders[0];
                        let topOrderRemainingQty = topOpenOrder?.qty! - topOpenOrder?.filledQty!
                        if (topOrderRemainingQty >= remainingQty) {
                            topOpenOrder!.filledQty += remainingQty;
                            remainingQty = remainingQty - topOrderRemainingQty > 0 ? remainingQty - topOrderRemainingQty : 0;
                            fillInfo.push({
                                price: bestPrice,
                                qty: remainingQty
                            })
                            addToUserFills(userId, { sellerId: topOpenOrder!.userId, buyerId: userId, filledQty: remainingQty, orderId: currentOrder.orderId, totalQty: currentOrder.qty })
                            if (remainingQty === 0) {
                                changeOrderStatus(userId, "FILLED", currentOrder.orderId);
                            }
                            if (topOpenOrder?.filledQty === topOpenOrder?.qty) {
                                changeOrderStatus(topOpenOrder!.userId, "FILLED", topOpenOrder!.orderId)
                            }
                        }
                        // else move to next order
                        topOpenOrder!.filledQty += topOrderRemainingQty
                        remainingQty -= topOrderRemainingQty;

                        fillInfo.push({
                            price: bestPrice,
                            qty: remainingQty
                        })
                        if (topOpenOrder?.filledQty === topOpenOrder!.qty) {
                            PriceLevelOrder.openOrders.shift();
                        }

                        const sellerMargin = getMarginOfUser(topOpenOrder!.userId, topOpenOrder!.orderId)
                        // changePosition(topOpenOrder!.userId, currentOrder.market, "SHORT", , sellerMargin, 0,)
                    }

                }

                // order sit on same side
                const buySide = getSameSide(currentOrder.market, currentOrder.type)
                const priceLevel = buySide.getElementByKey(currentOrder.price!);
                let orderDetail = { userId, qty: currentOrder.qty, filledQty: 0, orderId: currentOrder.orderId, createdAt: new Date() }

                if (!priceLevel) {
                    buySide.setElement(currentOrder.price!, { availableQty: currentOrder.qty, openOrders: [orderDetail] })
                } else {
                    priceLevel.availableQty += currentOrder.qty;
                    priceLevel.openOrders.push(orderDetail);
                    buySide.setElement(currentOrder.price!, priceLevel);
                }
            }
            // currentOrder sit on same side
            const buySide = getSameSide(currentOrder.market, currentOrder.type)
            const priceLevel = buySide.getElementByKey(currentOrder.price!);
            let orderDetail = { userId, qty: currentOrder.qty, filledQty: 0, orderId: currentOrder.orderId, createdAt: new Date() }

            if (!priceLevel) {
                buySide.setElement(currentOrder.price!, { availableQty: currentOrder.qty, openOrders: [orderDetail] })
            } else {
                priceLevel.availableQty += currentOrder.qty;
                priceLevel.openOrders.push(orderDetail);
                buySide.setElement(currentOrder.price!, priceLevel);
            }
        }

    }

    if (remainingQty === 0) currentOrder.status = 'FILLED'
    else currentOrder.status = 'PENDING'

    const buySide = getSameSide(currentOrder.market, currentOrder.type)
    const priceLevel = buySide.getElementByKey(currentOrder.price!);
    let orderDetail = { userId, qty: currentOrder.qty, filledQty: 0, orderId: currentOrder.orderId, createdAt: new Date() }

    if (!priceLevel) {
        buySide.setElement(currentOrder.price!, { availableQty: currentOrder.qty, openOrders: [orderDetail] })
    } else {
        priceLevel.availableQty += currentOrder.qty;
        priceLevel.openOrders.push(orderDetail);
        const { averagePrice, filledQty } = calculateAveragePrice(fillInfo);

        changePosition(userId, currentOrder.market, currentOrder.type, filledQty, currentOrder.margin, 0, averagePrice)


        return {
            ok: true,
            data: {
                filledQty,
                totalQty: currentOrder.qty,
                averagePrice,
                fills: fillInfo,

            }
        }
    }

}

function addToUserFills(userId: string, fill: Fill) {
    const userAvailabel = user[userId];
    userAvailabel?.fills.push(fill)
}

function matchOrder(userId: string, order: Order) {
    // 1. match orders .
    // 2. update order balance
    let fillInfo: FillInfo[] = []
    const oppositeSide = getOppositeSide(order.market, order.type);
    let remmainingQty = order.qty;
    while (oppositeSide.front() && remmainingQty > 0) {
        const [bestPrice, priceLevel] = oppositeSide.front()!;

        const priceCondition = order.type === "LONG" ? bestPrice <= order.price! : bestPrice >= order.price

        if (priceCondition) {
            // if (priceLevel.availableQty >= order.qty) {
            const topOpenOrder = priceLevel.openOrders[0];
            priceLevel.availableQty -= remmainingQty;

            while (topOpenOrder && remmainingQty > 0) {
                const topOrderRemainingQty = topOpenOrder!.qty - topOpenOrder!.filledQty;
                if (topOrderRemainingQty >= remmainingQty) {
                    remmainingQty = 0;
                    topOpenOrder.filledQty += remmainingQty;
                    fillInfo.push({
                        price: bestPrice,
                        qty: order.qty
                    })
                    addToUserFills(userId, { orderId: order.orderId, sellerId: userId, buyerId: topOpenOrder.userId, filledQty: remmainingQty, totalQty: order.qty })
                    changeOrderStatus(userId, "FILLED", order.orderId);
                    if (topOpenOrder.filledQty === topOpenOrder.qty) {
                        changeOrderStatus(topOpenOrder.userId, "FILLED", topOpenOrder.orderId);
                    }
                }
                priceLevel.openOrders.shift();
            }

            // }

        }
        oppositeSide.eraseElementByKey(bestPrice)
    }
    return {
        filledQty: order.qty - remmainingQty,
        fillInfo
    }

}

function putInOrderbook(userId: string, order: Order) {
    const sameSide = getSameSide(order.market, order.type);
    let orderDetails: Bid = {
        availableQty: order.qty,
        openOrders: [{
            userId,
            qty: order.qty,
            filledQty: 0,
            orderId: order.orderId,
            createdAt: new Date()
        }]
    }

    const pushPrice = sameSide.getElementByKey(order.price!);
    if (!pushPrice) {
        // create price 
        sameSide.setElement(order.price!, orderDetails)
        return
    }
    pushPrice!.availableQty += order.qty
    pushPrice?.openOrders.push(...orderDetails.openOrders)
    sameSide.setElement(order.price!, pushPrice)
}

function createShortLimitOrder(userId: string, currentOrder: Order) {

    // match as much as we can
    let { filledQty, fillInfo } = matchOrder(userId, currentOrder)

    // sit on same side
    if (filledQty < currentOrder.qty && currentOrder.kind == 'LIMIT')
        putInOrderbook(userId, currentOrder)

    const totalAvergae = fillInfo.reduce((acc, curr) => {
        acc.totalPrice += curr.qty * curr.price;
        acc.totalQty += curr.qty
        return acc
    }, { totalQty: 0, totalPrice: 0 })

    changePosition(userId, currentOrder.market, currentOrder.type, totalAvergae.totalQty, currentOrder.margin, 0, totalAvergae.totalPrice / totalAvergae.totalQty);
    const { averagePrice, filledQty: totalFilledQty } = calculateAveragePrice(fillInfo);
    return {
        ok: true,
        data: {
            fills: fillInfo,
            averagePrice,
            filledQty: totalFilledQty,
            totalQty: currentOrder.qty
        }
    }
}
function getMarginOfUser(userId: string, orderId: string) {
    const userAvailabel = user[userId];
    const orderMargin = userAvailabel!.orders.find((order) => {
        return order.orderId === orderId
    })

    return orderMargin?.margin
}

function createLongMarketOrder(userId: string, currentOrder: Order) {
    let fillInfo: FillInfo[] = [];
    const shortSide = getOppositeSide(currentOrder.market, currentOrder.type);
    let remainingQty = currentOrder.qty
    while (shortSide.front() && remainingQty > 0) {

        const [bestPrice, priceLevel] = shortSide.front()!;
        const tradeQty = Math.min(remainingQty, priceLevel.availableQty);

        priceLevel.availableQty -= tradeQty;
        const topPriceLevelOrder = priceLevel.openOrders[0]
        while (topPriceLevelOrder && remainingQty > 0) {
            const priceLevelAvailabelQty = topPriceLevelOrder.qty - topPriceLevelOrder.filledQty;
            const priceTradeQty = Math.min(priceLevelAvailabelQty, remainingQty);
            topPriceLevelOrder.filledQty += priceTradeQty;
            remainingQty -= priceTradeQty;
            changePosition(userId, currentOrder.market, "LONG", priceLevelAvailabelQty, currentOrder.margin, 0, bestPrice);
            const topOrderMargin = getMarginOfUser(topPriceLevelOrder.userId, topPriceLevelOrder.orderId)
            changePosition(topPriceLevelOrder.userId, currentOrder.market, "SHORT", priceLevelAvailabelQty, topOrderMargin!, 0, bestPrice)
            fillInfo.push({
                price: bestPrice,
                qty: priceLevelAvailabelQty
            });
            const fillsDetails: Fill = {
                sellerId: topPriceLevelOrder.userId,
                buyerId: userId,
                filledQty: priceLevelAvailabelQty,
                orderId: currentOrder.orderId,
                totalQty: currentOrder.qty
            }
            addToUserFills(userId, fillsDetails);
        }
        if (remainingQty === 0) {
            changeOrderStatus(userId, "FILLED", currentOrder.orderId);
        }
        if (topPriceLevelOrder?.filledQty === topPriceLevelOrder?.qty) {
            changeOrderStatus(userId, "FILLED", currentOrder.orderId)
        }
    }
    const { filledQty, averagePrice } = calculateAveragePrice(fillInfo);

    return {
        ok: true,
        data: {
            filledQty: filledQty,
            totalQty: currentOrder.qty,
            averagePrice,
            fillInfo
        }
    }
}
function createShortMarketOrder(userId: string, currentOrder: Order) {
    let fillInfo: FillInfo[] = [];

    const longSide = getOppositeSide(currentOrder.market, currentOrder.type)
    let remainingQty = currentOrder.qty;

    while (remainingQty > 0 && longSide.front()) {
        const [bestPrice, pricelevel] = longSide.front()!;

        const tradeQty = Math.min(pricelevel.availableQty - remainingQty);

        pricelevel.availableQty -= tradeQty;
        const topOrder = pricelevel.openOrders[0];
        while (topOrder && remainingQty > 0) {
            const orderLevelRemainingQty = topOrder.qty - topOrder.filledQty;
            const orderLevelTradeQty = Math.min(orderLevelRemainingQty, remainingQty);

            remainingQty -= orderLevelTradeQty;
            topOrder.filledQty += orderLevelTradeQty;
            fillInfo.push({
                price: bestPrice,
                qty: orderLevelTradeQty
            })
            let sellfillDetails: Fill = {
                sellerId: userId,
                buyerId: topOrder.userId,
                filledQty: orderLevelTradeQty,
                orderId: currentOrder.orderId,
                totalQty: currentOrder.qty

            }

            let buyFillDetails: Fill = {
                sellerId: topOrder.userId,
                buyerId: userId,
                filledQty: orderLevelTradeQty,
                orderId: currentOrder.orderId,
                totalQty: currentOrder.qty

            }

            addToUserFills(userId, sellfillDetails);
            addToUserFills(topOrder.userId, buyFillDetails);
            if (topOrder.filledQty === topOrder.qty) {
                changeOrderStatus(topOrder.userId, "FILLED", topOrder.orderId)
                pricelevel.openOrders.shift();
            }
        }
        if (pricelevel.availableQty === 0) {

        }
        if (remainingQty === 0) {
            changeOrderStatus(userId, "FILLED", currentOrder.orderId);
        }
        longSide.eraseElementByKey(bestPrice);
    }
    const { filledQty, averagePrice } = calculateAveragePrice(fillInfo);

    return {
        ok: true,
        data: {
            filledQty: filledQty,
            averagePrice: averagePrice,
            totalQty: currentOrder.qty,
            fillInfo
        }
    }
}


function getBalance(userId: string): Collateral | null {
    let userBalance = user[userId];
    if (!userBalance) {
        // TO DO in future return null because we don't want to show empty asset
        // now if user is not present return 
        return null;
    }
    return userBalance.collateral
}

function createUserOrder(userId: string, currentOrder: OrderType) {
    const userAvailabel = user[userId];
    if (!userAvailabel) {
        return null
    }
    const orderId = crypto.randomUUID();
    const orderDetails = {
        orderId,
        market: currentOrder.market,
        type: currentOrder.type,
        margin: currentOrder.,
        kind: currentOrder.kind,
        price: currentOrder.price,
        status: "PENDING" as Status,
        qty: currentOrder.qty
    }
    userAvailabel.orders.push(orderDetails);
    return orderDetails;
}

// function addBalance(userId: string, amount: number) {
//     let userBalance = user[userId];
//     if (!userBalance) {
//         return null
//     }
//     userBalance.collateral.availabel += amount;
//     return userBalance.collateral;

// }



function updateLockedOrAvailabelBalance(userId: string, updateInAmount?: number, updateInlocked?: number) {
    const userBalance = user[userId];
    if (!userBalance) {
        return null
    }

    if (updateInAmount) {
        userBalance.collateral.available += updateInAmount
    }
    if (updateInlocked) {
        userBalance.collateral.locked += updateInlocked;
    }
    return userBalance.collateral
}

function getOrCreateMarket(market: MARKET): Orderbook {
    let orderBookForMarket = orderbook[market];
    if (!orderBookForMarket) {
        orderBookForMarket = {
            bids: new OrderedMap([], (a, b) => (b - a)), asks: new OrderedMap([], (a, b) => (a - b)), indexPrice: 0, lastTradedPrice: 0
        }
    }
    return orderBookForMarket;
}

function getOppositeSide(market: MARKET, currentSide: Type) {
    let getMarket = getOrCreateMarket(market);
    const getOppositeSide = currentSide === "LONG" ? "asks" : "bids"
    let oppositeMarket = getMarket[getOppositeSide]
    return oppositeMarket;
}

function getSameSide(market: MARKET, curentSide: Type) {
    let getMarket = getOrCreateMarket(market);
    const getOppositeSide = curentSide === "LONG" ? "bids" : "asks"
    let oppositeMarket = getMarket[getOppositeSide]
    return oppositeMarket;
}


app.post("/order", (req, res) => {
    const { qty, market, kind, price, type, equity } = req.body;
    if (!qty || !market || !kind || !type || !equity) {
        return res.status(400).json({
            ok: false,
            message: "INVALID_FIELDS"
        })
    }
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json({
            ok: false,
            error: "USER_ID_NOT_PRESEN"
        })
    }
    const userBalance = getBalance(userId!);
    if (!userBalance) {
        return res.status(400).json({
            ok: false,
            error: "INSUFFICIENT_BALANCE"
        })
    }
    const { available, locked } = userBalance;
    if (available >= equity) {
        const updatedBalanceAvailabel = equity - available;
        const updatedBalanceLocked = equity + locked;
        updateLockedOrAvailabelBalance(userId!, updatedBalanceAvailabel, updatedBalanceLocked);



        if (kind === "LIMIT" && price) {
            let orderDetails: OrderType = {
                kind,
                margin: equity,
                market,
                price,
                qty,
                type
            }
            const currentOrder = createUserOrder(userId, orderDetails)
            if (!currentOrder) {
                return;
            }
            if (type === "LONG") {
                // long -  buy
                const orderResponse = createLongLimitOrder(userId, currentOrder);

                return orderResponse?.data;
            }
            else {
                // short - sell
                const orderResponse = createShortLimitOrder(userId, currentOrder);
                return orderResponse.data
            }
        }
        // market
        // long buy 
        let orderDetails: OrderType = {
            kind,
            margin: equity,
            market,
            qty,
            type
        }
        const currentOrder = createUserOrder(userId, orderDetails)
        if (!currentOrder) {
            return;
        }
        if (type === "LONG") {
            const orderResponse = createLongMarketOrder(userId, currentOrder);
            return orderResponse.data;

        } else {
            const orderResponse = createShortMarketOrder(userId, currentOrder);
            return orderResponse.data;
        }

    }
})
app.delete("/order", (req, res) => { })





























app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    res.status(500).json({
        error: err
    })
})



// app.post("/signup", (req, res) => {})
// app.post("/signin", (req, res) => {})
// app.post("/onramp", (req, res) => {})

// app.get("/equity/available", (req, res) => {})
// app.get("/positions/open/:marketId", (req, res) => {});
// app.get("/positions/closed/:marketId", (req, res) => {});
// app.get("/orders/open/:marketId", (req, res) => {})
// app.get("/orders/:marketId", (req, res) => {})
// app.get("/fills", (req, res) => {});


app.listen(3000, () => {
    console.log("server is running on http://localhost:3000");

})

import { OrderedMap } from "js-sdsl"

// simple bat hai market mai se nikalne ke liye positions close karni padegi qty = 0
export type MARKET = "SOL" | "USD" | "BTC"
export type Type = "LONG" | "SHORT"
export type Kind = "LIMIT" | "MARKET"
export type Status = "FILLED" | "CANCELLED" | "PENDING"
export interface Collateral {
    available: number,
    locked: number,
}

export interface currentOrderArgument {
    userId: string,
    market: MARKET, type: Type, margin: number, orderType: Kind, price: number
}
export interface Order {
    orderId: string,
    market: MARKET,
    type: Type
    margin: number,
    kind: Kind,
    price?: number,
    status: Status,
    qty: number
}
export interface OrderType {
    market: MARKET,
    type: Type
    margin: number,
    kind: Kind,
    price?: number,
    qty: number
}

export interface Positions {
    market: MARKET,
    type: Type,
    qty: number,
    margin: number,
    liquidationPrice: number,
    averagePrice: number

}

export interface Fill {
    sellerId: string,
    buyerId: string,
    orderId: string,
    filledQty: number,
    totalQty: number
}
// [[100 , 3] , [102 , 5]]
export type FillInfo = {
    price:number , 
    qty : number
}



export type Bid = {
    availableQty: number,
    openOrders: { userId: string, qty: number, filledQty: number, orderId: string, createdAt: Date }[]
}
export type Orderbook = {
    bids: OrderedMap<number, Bid>,
    asks: OrderedMap<number, Bid>,
    lastTradedPrice: number,
    indexPrice: number // average price of multiple exchange
}

/*
{
"USD":{
    bids:{}
    asks:{}
    lastTradedPrice:{},
    indexprice:
    }
}
*/
export type Orderbooks = Record<string, Orderbook>

export type User = Record<string, {
    password: string,
    collateral: Collateral,
    positions: Positions[],
    orders: Order[]
    fills: Fill[]
}>
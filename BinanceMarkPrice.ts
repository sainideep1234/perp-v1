import { market, type MARKET } from "./store/types";
import WebSocket from "ws";
const ws = new WebSocket("wss://fstream.binance.com/market/stream");


export const MarkPriceBook: Partial<Record<MARKET, number>> = {}


function MarketToListen(): string[] {
    const marketToListen = market.map((market: string) => {
        const lowerCase = market.toLowerCase()
        return `${lowerCase}usdt@markPrice@1s`
    })
    return marketToListen
}

const marketToListen = MarketToListen();

export function startListeningToBinanceForMarkPrice() {
    ws.on("open", () => {
        ws.send(JSON.stringify({ "method": "SUBSCRIBE", "params": marketToListen, "id": 9 }));
    });

    ws.on("message", (data) => {
        const parsedMessage = JSON.parse(data.toString());
        const markPrice = parsedMessage.data?.p;
        const markObject = parsedMessage?.stream
        const symbol = markObject?.split("@")[0];
        const asset = symbol?.replace("usdt", "");
        const capitalAsset = asset?.toUpperCase();

        if (capitalAsset === "BTC") {
            MarkPriceBook.BTC = markPrice
        }
        if (capitalAsset === "SOL") {
            MarkPriceBook.SOL = markPrice
        }
        console.log(MarkPriceBook)
    })

}
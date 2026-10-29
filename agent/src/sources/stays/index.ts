import type { StaySource } from "../../stays/types.js";
import { airbnb } from "./airbnb.js";
import { booking } from "./booking.js";
import { expedia } from "./expedia.js";
import { googleHotels } from "./googleHotels.js";

export const STAY_SOURCES: StaySource[] = [googleHotels, airbnb, booking, expedia];

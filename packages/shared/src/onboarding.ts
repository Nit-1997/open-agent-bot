export type Access = "searched" | "linked";
export type Chip = { label: string; access?: Access };
export type Place = { label: string; city?: string; region?: string; country?: string; lat: number; lon: number };

export type OnboardingOptions = {
  country: string;
  currency: string;
  units: "imperial" | "metric";
  airports: string[];
  groceriesNearby: boolean;
  rows: {
    airlines: string[];
    hotelChains: string[];
    sites: Chip[];
    groceries: string[];
    retail: string[];
    delivery: string[];
  };
};

export const HOUSEHOLD = { justMe: "Just me", partner: "Married / partner", kids: "Kids", pets: "Pets" } as const;
export const KID_BANDS = ["0–3", "4–8", "9–12", "13–17"];
export const KIDS_ANY = "any age";
export const PET_KINDS = ["Dog", "Cat"];
export const PETS_ANY = "pet";
export const NO_FOOD_RULES = "No restrictions";
export const FOOD = [NO_FOOD_RULES, "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free", "Nut allergy"];
export const NO_AIRLINE = "No preference";
export const NO_DELIVERY = "None";
export const INDEPENDENT = "Independent";

export const TRAVEL_STYLES = [
  { id: "budget", label: "Budget" },
  { id: "comfort", label: "Comfort" },
  { id: "luxury", label: "Luxury" },
] as const;

export const SHOPPING_STYLES = [
  { id: "save", label: "Save where I can" },
  { id: "balanced", label: "Balanced" },
  { id: "treat", label: "Treat myself" },
] as const;

export const STAY_CHOICES = [
  { id: "hotel", label: "Hotels" },
  { id: "rental", label: "Vacation rentals" },
] as const;

type Curated = {
  airlines: string[];
  hotelChains: string[];
  sites: string[];
  groceries: string[];
  retail: string[];
  delivery: string[];
};

export const CURATED: Record<string, Curated> = {
  US: {
    airlines: ["Southwest", "United", "Alaska", "Delta", "American", "JetBlue"],
    hotelChains: ["Marriott", "Hilton", "Hyatt", "IHG", INDEPENDENT],
    sites: ["Expedia", "Vrbo", "Kayak", "Hotels.com"],
    groceries: ["Trader Joe's", "Safeway", "Whole Foods", "Costco", "Kroger", "Target"],
    retail: ["Amazon", "Target", "Walmart", "Best Buy", "Costco", "IKEA"],
    delivery: ["Instacart", "DoorDash", "Uber Eats", "Shipt", "Amazon Fresh"],
  },
  IN: {
    airlines: ["IndiGo", "Air India", "Akasa Air", "SpiceJet", "Vistara"],
    hotelChains: ["Taj", "ITC Hotels", "Oberoi", "Marriott", "OYO", INDEPENDENT],
    sites: ["MakeMyTrip", "Goibibo", "Agoda", "Cleartrip"],
    groceries: ["BigBasket", "DMart", "Reliance Fresh", "More", "Nature's Basket", "Spencer's"],
    retail: ["Amazon India", "Flipkart", "Myntra", "Croma", "Reliance Digital", "Nykaa"],
    delivery: ["Blinkit", "Zepto", "Swiggy Instamart", "BigBasket", "Zomato", "Swiggy"],
  },
  GB: {
    airlines: ["British Airways", "easyJet", "Ryanair", "Virgin Atlantic", "Jet2"],
    hotelChains: ["Premier Inn", "Travelodge", "Hilton", "Marriott", "IHG", INDEPENDENT],
    sites: ["Expedia", "Skyscanner", "Hotels.com", "Trainline"],
    groceries: ["Tesco", "Sainsbury's", "Asda", "Aldi", "Lidl", "Waitrose"],
    retail: ["Amazon UK", "Argos", "John Lewis", "Currys", "IKEA", "Boots"],
    delivery: ["Ocado", "Deliveroo", "Uber Eats", "Just Eat", "Getir"],
  },
  "*": {
    airlines: ["Emirates", "Qatar Airways", "Lufthansa", "Turkish Airlines", "Singapore Airlines"],
    hotelChains: ["Marriott", "Hilton", "Accor", "IHG", "Hyatt", INDEPENDENT],
    sites: ["Expedia", "Agoda", "Skyscanner", "Hotels.com"],
    groceries: ["Carrefour", "Lidl", "Aldi", "Costco"],
    retail: ["Amazon", "IKEA", "AliExpress"],
    delivery: ["Uber Eats", "Glovo", "Deliveroo"],
  },
};

export const curatedFor = (country: string | undefined): Curated => CURATED[country?.toUpperCase() ?? ""] ?? CURATED["*"];

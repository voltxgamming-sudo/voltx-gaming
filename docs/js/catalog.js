// ============================================================
// EDIT THIS FILE to change the store. Everything here is DEMO data.
// Replace prices and packages only with figures confirmed by an authorised supplier.
// ============================================================

export const SITE = {
  name: 'VoltX Gaming',
  tagline: 'Level Up Your Game',
  subtitle: 'Your Favorite Games. Simple Top-Ups.',
  currency: 'EGP',
  // WhatsApp number in international format, digits only, no "+" or spaces.
  // Example for Egypt: '201012345678'. Leave '' to show a copy-text fallback instead.
  whatsappNumber: '',
};

// idPattern / extraPattern are placeholder format checks. Confirm them with your provider.
export const GAMES = [
  {
    id: 'pubg-mobile',
    name: 'PUBG MOBILE',
    category: 'Battle Royale',
    currencyLabel: 'UC',
    description: 'Unknown Cash (UC) top-up packages for PUBG MOBILE.',
    featured: true,
    idLabel: 'Player ID',
    idPattern: '^[0-9]{8,12}$',
    extraLabel: null,
    extraPattern: null,
    packages: [
      { id: 'uc-60', label: '60 UC', amount: 60, priceEgp: 30 },
      { id: 'uc-325', label: '325 UC', amount: 325, priceEgp: 150 },
      { id: 'uc-660', label: '660 UC', amount: 660, priceEgp: 300 },
      { id: 'uc-1800', label: '1800 UC', amount: 1800, priceEgp: 750 },
    ],
  },
  {
    id: 'free-fire',
    name: 'Free Fire',
    category: 'Battle Royale',
    currencyLabel: 'Diamonds',
    description: 'Diamond packages for Free Fire.',
    featured: true,
    idLabel: 'Player ID',
    idPattern: '^[0-9]{6,12}$',
    extraLabel: null,
    extraPattern: null,
    packages: [
      { id: 'ff-100', label: '100 Diamonds', amount: 100, priceEgp: 25 },
      { id: 'ff-310', label: '310 Diamonds', amount: 310, priceEgp: 75 },
      { id: 'ff-520', label: '520 Diamonds', amount: 520, priceEgp: 125 },
      { id: 'ff-1060', label: '1060 Diamonds', amount: 1060, priceEgp: 250 },
    ],
  },
  {
    id: 'roblox',
    name: 'Roblox',
    category: 'Sandbox',
    currencyLabel: 'Robux',
    description: 'Robux packages for Roblox.',
    featured: false,
    idLabel: 'Username',
    idPattern: '^[A-Za-z0-9_]{3,20}$',
    extraLabel: null,
    extraPattern: null,
    packages: [
      { id: 'rbx-400', label: '400 Robux', amount: 400, priceEgp: 150 },
      { id: 'rbx-800', label: '800 Robux', amount: 800, priceEgp: 290 },
      { id: 'rbx-1700', label: '1700 Robux', amount: 1700, priceEgp: 600 },
    ],
  },
  {
    id: 'mobile-legends',
    name: 'Mobile Legends',
    category: 'MOBA',
    currencyLabel: 'Diamonds',
    description: 'Diamond packages for Mobile Legends. The Zone ID is required.',
    featured: false,
    idLabel: 'User ID',
    idPattern: '^[0-9]{6,12}$',
    extraLabel: 'Zone ID',
    extraPattern: '^[0-9]{3,6}$',
    packages: [
      { id: 'ml-86', label: '86 Diamonds', amount: 86, priceEgp: 40 },
      { id: 'ml-172', label: '172 Diamonds', amount: 172, priceEgp: 80 },
      { id: 'ml-257', label: '257 Diamonds', amount: 257, priceEgp: 120 },
      { id: 'ml-706', label: '706 Diamonds', amount: 706, priceEgp: 320 },
    ],
  },
];

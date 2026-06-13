// Airport data: IATA code, name, city, country, lat, lon, population (millions, metro area)
// Population drives passenger demand in the gravity model.
// effectivePop (optional): demand catchment in millions for major hubs whose metro population
//   understates true demand due to connecting traffic / national gateway role.
// tier: 'mega' | 'major' | 'regional' — affects hub bonus calculations

export const AIRPORTS = [
  // ── NORTH AMERICA ───────────────────────────────────────────────────────────
  { code: 'JFK', name: 'John F. Kennedy Intl',      city: 'New York',       country: 'US', lat: 40.64,  lon: -73.78,   population: 20.1, tier: 'mega'     },
  { code: 'LAX', name: 'Los Angeles Intl',           city: 'Los Angeles',    country: 'US', lat: 33.94,  lon: -118.40,  population: 13.2, tier: 'mega'     },
  { code: 'ORD', name: "O'Hare Intl",                city: 'Chicago',        country: 'US', lat: 41.97,  lon: -87.90,   population: 9.5,  tier: 'mega'     },
  { code: 'ATL', name: 'Hartsfield-Jackson',         city: 'Atlanta',        country: 'US', lat: 33.64,  lon: -84.43,   population: 6.2,  tier: 'mega'     },
  { code: 'DFW', name: 'Dallas/Fort Worth Intl',     city: 'Dallas',         country: 'US', lat: 32.90,  lon: -97.04,   population: 7.7,  tier: 'mega'     },
  { code: 'DEN', name: 'Denver Intl',                city: 'Denver',         country: 'US', lat: 39.86,  lon: -104.67,  population: 2.9,  tier: 'major'    },
  { code: 'SFO', name: 'San Francisco Intl',         city: 'San Francisco',  country: 'US', lat: 37.62,  lon: -122.38,  population: 4.7,  tier: 'major',  effectivePop: 10 },
  { code: 'SEA', name: 'Seattle-Tacoma Intl',        city: 'Seattle',        country: 'US', lat: 47.45,  lon: -122.31,  population: 4.0,  tier: 'major'    },
  { code: 'MIA', name: 'Miami Intl',                 city: 'Miami',          country: 'US', lat: 25.79,  lon: -80.29,   population: 6.2,  tier: 'major'    },
  { code: 'BOS', name: 'Logan Intl',                 city: 'Boston',         country: 'US', lat: 42.37,  lon: -71.00,   population: 4.9,  tier: 'major'    },
  { code: 'LAS', name: 'Harry Reid Intl',            city: 'Las Vegas',      country: 'US', lat: 36.08,  lon: -115.15,  population: 2.3,  tier: 'major'    },
  { code: 'PHX', name: 'Phoenix Sky Harbor',         city: 'Phoenix',        country: 'US', lat: 33.44,  lon: -112.01,  population: 5.1,  tier: 'major'    },
  { code: 'IAD', name: 'Dulles Intl',                city: 'Washington DC',  country: 'US', lat: 38.94,  lon: -77.46,   population: 6.4,  tier: 'major'    },
  { code: 'MSP', name: 'Minneapolis-St. Paul Intl',  city: 'Minneapolis',    country: 'US', lat: 44.88,  lon: -93.22,   population: 3.7,  tier: 'major'    },
  { code: 'YYZ', name: 'Toronto Pearson Intl',       city: 'Toronto',        country: 'CA', lat: 43.68,  lon: -79.63,   population: 6.2,  tier: 'mega'     },
  { code: 'YVR', name: 'Vancouver Intl',             city: 'Vancouver',      country: 'CA', lat: 49.19,  lon: -123.18,  population: 2.6,  tier: 'regional' },
  { code: 'YUL', name: 'Montréal-Trudeau Intl',      city: 'Montreal',       country: 'CA', lat: 45.47,  lon: -73.74,   population: 4.2,  tier: 'regional' },
  { code: 'MEX', name: 'Benito Juárez Intl',         city: 'Mexico City',    country: 'MX', lat: 19.44,  lon: -99.07,   population: 21.7, tier: 'mega'     },
  { code: 'GDL', name: 'Miguel Hidalgo Intl',        city: 'Guadalajara',    country: 'MX', lat: 20.52,  lon: -103.31,  population: 5.3,  tier: 'regional' },
  { code: 'CUN', name: 'Cancún Intl',                city: 'Cancún',         country: 'MX', lat: 21.04,  lon: -86.87,   population: 0.9,  tier: 'regional' },
  { code: 'PTY', name: 'Tocumen Intl',               city: 'Panama City',    country: 'PA', lat: 9.07,   lon: -79.38,   population: 2.0,  tier: 'regional' },

  // ── SOUTH AMERICA ────────────────────────────────────────────────────────────
  { code: 'GRU', name: 'São Paulo/Guarulhos Intl',   city: 'São Paulo',      country: 'BR', lat: -23.43, lon: -46.47,   population: 22.4, tier: 'mega'     },
  { code: 'GIG', name: 'Rio Galeão Intl',            city: 'Rio de Janeiro', country: 'BR', lat: -22.81, lon: -43.25,   population: 13.6, tier: 'major'    },
  { code: 'BSB', name: 'Pres. Juscelino K. Intl',    city: 'Brasília',       country: 'BR', lat: -15.87, lon: -47.92,   population: 3.0,  tier: 'regional' },
  { code: 'EZE', name: 'Ministro Pistarini Intl',    city: 'Buenos Aires',   country: 'AR', lat: -34.82, lon: -58.53,   population: 15.0, tier: 'mega'     },
  { code: 'SCL', name: 'Arturo Merino Benítez Intl', city: 'Santiago',       country: 'CL', lat: -33.39, lon: -70.79,   population: 7.4,  tier: 'major'    },
  { code: 'BOG', name: 'El Dorado Intl',             city: 'Bogotá',         country: 'CO', lat: 4.70,   lon: -74.15,   population: 11.3, tier: 'major'    },
  { code: 'LIM', name: 'Jorge Chávez Intl',          city: 'Lima',           country: 'PE', lat: -12.02, lon: -77.11,   population: 11.0, tier: 'major'    },

  // ── EUROPE ───────────────────────────────────────────────────────────────────
  { code: 'LHR', name: 'Heathrow',                   city: 'London',         country: 'GB', lat: 51.47,  lon: -0.45,    population: 9.3,  tier: 'mega', effectivePop: 22 },
  { code: 'CDG', name: 'Charles de Gaulle',          city: 'Paris',          country: 'FR', lat: 49.01,  lon: 2.55,     population: 11.0, tier: 'mega'     },
  { code: 'FRA', name: 'Frankfurt Airport',          city: 'Frankfurt',      country: 'DE', lat: 50.03,  lon: 8.57,     population: 5.8,  tier: 'mega',  effectivePop: 12 },
  { code: 'AMS', name: 'Amsterdam Schiphol',         city: 'Amsterdam',      country: 'NL', lat: 52.31,  lon: 4.77,     population: 2.5,  tier: 'mega',  effectivePop: 9  },
  { code: 'MAD', name: 'Adolfo Suárez Barajas',      city: 'Madrid',         country: 'ES', lat: 40.47,  lon: -3.57,    population: 6.7,  tier: 'major'    },
  { code: 'BCN', name: 'Josep Tarradellas Barcelona',city: 'Barcelona',      country: 'ES', lat: 41.30,  lon: 2.08,     population: 5.6,  tier: 'major'    },
  { code: 'FCO', name: 'Fiumicino',                  city: 'Rome',           country: 'IT', lat: 41.80,  lon: 12.24,    population: 4.3,  tier: 'major'    },
  { code: 'MXP', name: 'Malpensa',                   city: 'Milan',          country: 'IT', lat: 45.63,  lon: 8.73,     population: 3.2,  tier: 'major'    },
  { code: 'MUC', name: 'Munich Airport',             city: 'Munich',         country: 'DE', lat: 48.35,  lon: 11.79,    population: 2.9,  tier: 'major'    },
  { code: 'ZRH', name: 'Zurich Airport',             city: 'Zurich',         country: 'CH', lat: 47.46,  lon: 8.55,     population: 1.4,  tier: 'major'    },
  { code: 'VIE', name: 'Vienna Intl',                city: 'Vienna',         country: 'AT', lat: 48.11,  lon: 16.57,    population: 1.9,  tier: 'regional' },
  { code: 'BRU', name: 'Brussels Airport',           city: 'Brussels',       country: 'BE', lat: 50.90,  lon: 4.48,     population: 2.1,  tier: 'regional' },
  { code: 'LIS', name: 'Humberto Delgado Airport',   city: 'Lisbon',         country: 'PT', lat: 38.77,  lon: -9.13,    population: 2.9,  tier: 'regional' },
  { code: 'OSL', name: 'Oslo Gardermoen',            city: 'Oslo',           country: 'NO', lat: 60.20,  lon: 11.08,    population: 1.0,  tier: 'regional' },
  { code: 'ARN', name: 'Stockholm Arlanda',          city: 'Stockholm',      country: 'SE', lat: 59.65,  lon: 17.92,    population: 2.4,  tier: 'regional' },
  { code: 'HEL', name: 'Helsinki-Vantaa',            city: 'Helsinki',       country: 'FI', lat: 60.32,  lon: 24.96,    population: 1.5,  tier: 'regional' },
  { code: 'CPH', name: 'Copenhagen Airport',         city: 'Copenhagen',     country: 'DK', lat: 55.62,  lon: 12.66,    population: 1.3,  tier: 'regional' },
  { code: 'DUB', name: 'Dublin Airport',             city: 'Dublin',         country: 'IE', lat: 53.42,  lon: -6.27,    population: 1.4,  tier: 'regional' },
  { code: 'WAW', name: 'Chopin Airport',             city: 'Warsaw',         country: 'PL', lat: 52.17,  lon: 20.97,    population: 1.8,  tier: 'regional' },
  { code: 'ATH', name: 'Athens Intl',                city: 'Athens',         country: 'GR', lat: 37.94,  lon: 23.95,    population: 3.7,  tier: 'regional' },
  { code: 'IST', name: 'Istanbul Airport',           city: 'Istanbul',       country: 'TR', lat: 41.26,  lon: 28.74,    population: 15.6, tier: 'mega'     },

  // ── MIDDLE EAST ──────────────────────────────────────────────────────────────
  { code: 'DXB', name: 'Dubai Intl',                 city: 'Dubai',          country: 'AE', lat: 25.25,  lon: 55.36,    population: 3.3,  tier: 'mega', effectivePop: 18 },
  { code: 'AUH', name: 'Abu Dhabi Intl',             city: 'Abu Dhabi',      country: 'AE', lat: 24.44,  lon: 54.65,    population: 1.5,  tier: 'major'    },
  { code: 'DOH', name: 'Hamad Intl',                 city: 'Doha',           country: 'QA', lat: 25.27,  lon: 51.61,    population: 2.4,  tier: 'mega',  effectivePop: 8 },
  { code: 'RUH', name: 'King Khalid Intl',           city: 'Riyadh',         country: 'SA', lat: 24.96,  lon: 46.70,    population: 7.7,  tier: 'major'    },
  { code: 'TLV', name: 'Ben Gurion Intl',            city: 'Tel Aviv',       country: 'IL', lat: 32.01,  lon: 34.89,    population: 4.3,  tier: 'regional' },

  // ── AFRICA ───────────────────────────────────────────────────────────────────
  { code: 'JNB', name: 'O.R. Tambo Intl',           city: 'Johannesburg',   country: 'ZA', lat: -26.13, lon: 28.24,    population: 10.0, tier: 'major'    },
  { code: 'CPT', name: 'Cape Town Intl',             city: 'Cape Town',      country: 'ZA', lat: -33.96, lon: 18.60,    population: 4.6,  tier: 'regional' },
  { code: 'CAI', name: 'Cairo Intl',                 city: 'Cairo',          country: 'EG', lat: 30.11,  lon: 31.40,    population: 21.3, tier: 'mega'     },
  { code: 'NBO', name: 'Jomo Kenyatta Intl',         city: 'Nairobi',        country: 'KE', lat: -1.32,  lon: 36.93,    population: 5.1,  tier: 'regional' },
  { code: 'LOS', name: 'Murtala Muhammed Intl',      city: 'Lagos',          country: 'NG', lat: 6.58,   lon: 3.32,     population: 14.9, tier: 'major'    },
  { code: 'CMN', name: 'Mohammed V Intl',            city: 'Casablanca',     country: 'MA', lat: 33.37,  lon: -7.59,    population: 4.4,  tier: 'regional' },
  { code: 'ADD', name: 'Addis Ababa Bole Intl',      city: 'Addis Ababa',    country: 'ET', lat: 8.98,   lon: 38.80,    population: 5.0,  tier: 'regional' },

  // ── SOUTH & SOUTHEAST ASIA ──────────────────────────────────────────────────
  { code: 'SIN', name: 'Changi Airport',             city: 'Singapore',      country: 'SG', lat: 1.36,   lon: 103.99,   population: 5.7,  tier: 'mega', effectivePop: 22 },
  { code: 'HKG', name: 'Hong Kong Intl',             city: 'Hong Kong',      country: 'HK', lat: 22.31,  lon: 113.91,   population: 7.5,  tier: 'mega', effectivePop: 18 },
  { code: 'KUL', name: 'Kuala Lumpur Intl',          city: 'Kuala Lumpur',   country: 'MY', lat: 2.74,   lon: 101.71,   population: 8.3,  tier: 'major'    },
  { code: 'BKK', name: 'Suvarnabhumi Airport',       city: 'Bangkok',        country: 'TH', lat: 13.69,  lon: 100.75,   population: 15.7, tier: 'major'    },
  { code: 'CGK', name: 'Soekarno-Hatta Intl',        city: 'Jakarta',        country: 'ID', lat: -6.13,  lon: 106.66,   population: 34.5, tier: 'mega'     },
  { code: 'MNL', name: 'Ninoy Aquino Intl',          city: 'Manila',         country: 'PH', lat: 14.51,  lon: 121.02,   population: 14.4, tier: 'major'    },
  { code: 'DEL', name: 'Indira Gandhi Intl',         city: 'Delhi',          country: 'IN', lat: 28.56,  lon: 77.10,    population: 32.9, tier: 'mega'     },
  { code: 'BOM', name: 'Chhatrapati Shivaji Intl',   city: 'Mumbai',         country: 'IN', lat: 19.09,  lon: 72.87,    population: 20.7, tier: 'mega'     },
  { code: 'BLR', name: 'Kempegowda Intl',            city: 'Bangalore',      country: 'IN', lat: 13.20,  lon: 77.71,    population: 13.2, tier: 'major'    },
  { code: 'CMB', name: 'Bandaranaike Intl',          city: 'Colombo',        country: 'LK', lat: 7.18,   lon: 79.88,    population: 3.7,  tier: 'regional' },

  // ── EAST ASIA ────────────────────────────────────────────────────────────────
  { code: 'NRT', name: 'Narita Intl',                city: 'Tokyo',          country: 'JP', lat: 35.76,  lon: 140.38,   population: 37.4, tier: 'mega'     },
  { code: 'HND', name: 'Tokyo Haneda',               city: 'Tokyo',          country: 'JP', lat: 35.55,  lon: 139.78,   population: 37.4, tier: 'mega'     },
  { code: 'KIX', name: 'Kansai Intl',                city: 'Osaka',          country: 'JP', lat: 34.43,  lon: 135.24,   population: 19.3, tier: 'major'    },
  { code: 'ICN', name: 'Incheon Intl',               city: 'Seoul',          country: 'KR', lat: 37.46,  lon: 126.44,   population: 9.8,  tier: 'mega'     },
  { code: 'PEK', name: 'Beijing Capital Intl',       city: 'Beijing',        country: 'CN', lat: 40.08,  lon: 116.58,   population: 21.5, tier: 'mega'     },
  { code: 'PVG', name: 'Shanghai Pudong Intl',       city: 'Shanghai',       country: 'CN', lat: 31.14,  lon: 121.80,   population: 27.1, tier: 'mega'     },
  { code: 'CAN', name: 'Guangzhou Baiyun Intl',      city: 'Guangzhou',      country: 'CN', lat: 23.39,  lon: 113.30,   population: 18.7, tier: 'mega'     },
  { code: 'CTU', name: 'Chengdu Tianfu Intl',        city: 'Chengdu',        country: 'CN', lat: 30.31,  lon: 104.44,   population: 9.1,  tier: 'major'    },
  { code: 'TPE', name: 'Taoyuan Intl',               city: 'Taipei',         country: 'TW', lat: 25.08,  lon: 121.23,   population: 7.0,  tier: 'major'    },

  // ── OCEANIA ──────────────────────────────────────────────────────────────────
  { code: 'SYD', name: 'Kingsford Smith',            city: 'Sydney',         country: 'AU', lat: -33.94, lon: 151.18,   population: 5.3,  tier: 'major'    },
  { code: 'MEL', name: 'Melbourne Airport',          city: 'Melbourne',      country: 'AU', lat: -37.67, lon: 144.84,   population: 5.1,  tier: 'major'    },
  { code: 'BNE', name: 'Brisbane Airport',           city: 'Brisbane',       country: 'AU', lat: -27.38, lon: 153.12,   population: 2.5,  tier: 'regional' },
  { code: 'AKL', name: 'Auckland Airport',           city: 'Auckland',       country: 'NZ', lat: -37.01, lon: 174.79,   population: 1.7,  tier: 'regional' },

  // ── NORTH AMERICA (additional) ───────────────────────────────────────────────
  { code: 'EWR', name: 'Newark Liberty Intl',          city: 'New York',        country: 'US', lat: 40.69,  lon: -74.17,   population: 20.1, tier: 'major'    },
  { code: 'LGA', name: 'LaGuardia Airport',             city: 'New York',        country: 'US', lat: 40.78,  lon: -73.87,   population: 20.1, tier: 'major'    },
  { code: 'SAN', name: 'San Diego Intl',                city: 'San Diego',       country: 'US', lat: 32.73,  lon: -117.19,  population: 3.3,  tier: 'regional' },
  { code: 'MCO', name: 'Orlando Intl',                  city: 'Orlando',         country: 'US', lat: 28.43,  lon: -81.31,   population: 2.7,  tier: 'major'    },
  { code: 'TPA', name: 'Tampa Intl',                    city: 'Tampa',           country: 'US', lat: 27.98,  lon: -82.53,   population: 3.2,  tier: 'regional' },
  { code: 'DTW', name: 'Detroit Metro Wayne County',    city: 'Detroit',         country: 'US', lat: 42.21,  lon: -83.35,   population: 4.4,  tier: 'major'    },
  { code: 'PHL', name: 'Philadelphia Intl',             city: 'Philadelphia',    country: 'US', lat: 39.87,  lon: -75.24,   population: 6.1,  tier: 'major'    },
  { code: 'CLT', name: 'Charlotte Douglas Intl',        city: 'Charlotte',       country: 'US', lat: 35.21,  lon: -80.94,   population: 2.7,  tier: 'major'    },
  { code: 'BWI', name: 'Baltimore/Washington Intl',     city: 'Baltimore',       country: 'US', lat: 39.17,  lon: -76.67,   population: 2.9,  tier: 'regional' },
  { code: 'DCA', name: 'Reagan National Airport',        city: 'Washington DC',   country: 'US', lat: 38.85,  lon: -77.04,   population: 6.4,  tier: 'major'    },
  { code: 'IAH', name: 'George Bush Intercontinental',  city: 'Houston',         country: 'US', lat: 29.98,  lon: -95.34,   population: 7.3,  tier: 'major'    },
  { code: 'HOU', name: 'William P. Hobby Airport',      city: 'Houston',         country: 'US', lat: 29.65,  lon: -95.28,   population: 7.3,  tier: 'regional' },
  { code: 'SLC', name: 'Salt Lake City Intl',           city: 'Salt Lake City',  country: 'US', lat: 40.79,  lon: -111.98,  population: 1.2,  tier: 'regional' },
  { code: 'PDX', name: 'Portland Intl',                 city: 'Portland',        country: 'US', lat: 45.59,  lon: -122.60,  population: 2.5,  tier: 'regional' },
  { code: 'OAK', name: 'Oakland Intl',                  city: 'Oakland',         country: 'US', lat: 37.72,  lon: -122.22,  population: 4.7,  tier: 'regional' },
  { code: 'SJC', name: 'Norman Y. Mineta San Jose',     city: 'San Jose',        country: 'US', lat: 37.36,  lon: -121.93,  population: 2.0,  tier: 'regional' },
  { code: 'SMF', name: 'Sacramento Intl',               city: 'Sacramento',      country: 'US', lat: 38.70,  lon: -121.59,  population: 2.3,  tier: 'regional' },
  { code: 'RNO', name: 'Reno-Tahoe Intl',               city: 'Reno',            country: 'US', lat: 39.50,  lon: -119.77,  population: 0.5,  tier: 'regional' },
  { code: 'STL', name: 'Lambert-St. Louis Intl',        city: 'St. Louis',       country: 'US', lat: 38.75,  lon: -90.37,   population: 2.8,  tier: 'regional' },
  { code: 'BNA', name: 'Nashville Intl',                city: 'Nashville',       country: 'US', lat: 36.12,  lon: -86.68,   population: 2.0,  tier: 'regional' },
  { code: 'MSY', name: 'Louis Armstrong Intl',          city: 'New Orleans',     country: 'US', lat: 29.99,  lon: -90.26,   population: 1.3,  tier: 'regional' },
  { code: 'MEM', name: 'Memphis Intl',                  city: 'Memphis',         country: 'US', lat: 35.04,  lon: -89.98,   population: 1.3,  tier: 'regional' },
  { code: 'IND', name: 'Indianapolis Intl',             city: 'Indianapolis',    country: 'US', lat: 39.72,  lon: -86.29,   population: 2.1,  tier: 'regional' },
  { code: 'CLE', name: 'Cleveland Hopkins Intl',        city: 'Cleveland',       country: 'US', lat: 41.41,  lon: -81.85,   population: 2.0,  tier: 'regional' },
  { code: 'CMH', name: 'John Glenn Columbus Intl',      city: 'Columbus',        country: 'US', lat: 40.00,  lon: -82.89,   population: 2.1,  tier: 'regional' },
  { code: 'PIT', name: 'Pittsburgh Intl',               city: 'Pittsburgh',      country: 'US', lat: 40.49,  lon: -80.23,   population: 2.4,  tier: 'regional' },
  { code: 'RDU', name: 'Raleigh-Durham Intl',           city: 'Raleigh',         country: 'US', lat: 35.88,  lon: -78.79,   population: 1.4,  tier: 'regional' },
  { code: 'JAX', name: 'Jacksonville Intl',             city: 'Jacksonville',    country: 'US', lat: 30.49,  lon: -81.69,   population: 1.5,  tier: 'regional' },
  { code: 'AUS', name: 'Austin-Bergstrom Intl',         city: 'Austin',          country: 'US', lat: 30.20,  lon: -97.67,   population: 2.2,  tier: 'regional' },
  { code: 'SAT', name: 'San Antonio Intl',              city: 'San Antonio',     country: 'US', lat: 29.53,  lon: -98.47,   population: 2.5,  tier: 'regional' },
  { code: 'FLL', name: 'Fort Lauderdale-Hollywood Intl',city: 'Fort Lauderdale', country: 'US', lat: 26.07,  lon: -80.15,   population: 1.9,  tier: 'regional' },
  { code: 'PBI', name: 'Palm Beach Intl',               city: 'West Palm Beach', country: 'US', lat: 26.68,  lon: -80.10,   population: 1.5,  tier: 'regional' },
  { code: 'ABQ', name: 'Albuquerque Sunport',           city: 'Albuquerque',     country: 'US', lat: 35.04,  lon: -106.61,  population: 0.9,  tier: 'regional' },
  { code: 'BOI', name: 'Boise Airport',                 city: 'Boise',           country: 'US', lat: 43.56,  lon: -116.22,  population: 0.8,  tier: 'regional' },
  { code: 'GEG', name: 'Spokane Intl',                  city: 'Spokane',         country: 'US', lat: 47.62,  lon: -117.53,  population: 0.6,  tier: 'regional' },
  { code: 'TUS', name: 'Tucson Intl',                   city: 'Tucson',          country: 'US', lat: 32.12,  lon: -110.94,  population: 1.0,  tier: 'regional' },
  { code: 'ELP', name: 'El Paso Intl',                  city: 'El Paso',         country: 'US', lat: 31.81,  lon: -106.38,  population: 0.8,  tier: 'regional' },
  { code: 'OMA', name: 'Eppley Airfield',               city: 'Omaha',           country: 'US', lat: 41.30,  lon: -95.89,   population: 0.9,  tier: 'regional' },
  { code: 'DSM', name: 'Des Moines Intl',               city: 'Des Moines',      country: 'US', lat: 41.53,  lon: -93.66,   population: 0.7,  tier: 'regional' },
  { code: 'MKE', name: 'Milwaukee Mitchell Intl',       city: 'Milwaukee',       country: 'US', lat: 42.95,  lon: -87.90,   population: 1.6,  tier: 'regional' },
  { code: 'MDW', name: 'Chicago Midway Intl',           city: 'Chicago',         country: 'US', lat: 41.79,  lon: -87.75,   population: 9.5,  tier: 'regional' },
  { code: 'BHM', name: 'Birmingham-Shuttlesworth Intl', city: 'Birmingham',      country: 'US', lat: 33.56,  lon: -86.75,   population: 1.1,  tier: 'regional' },
  { code: 'SDF', name: 'Louisville Intl',               city: 'Louisville',      country: 'US', lat: 38.17,  lon: -85.74,   population: 1.4,  tier: 'regional' },
  { code: 'RIC', name: 'Richmond Intl',                 city: 'Richmond',        country: 'US', lat: 37.50,  lon: -77.32,   population: 1.3,  tier: 'regional' },
  { code: 'ORF', name: 'Norfolk Intl',                  city: 'Norfolk',         country: 'US', lat: 36.90,  lon: -76.02,   population: 1.8,  tier: 'regional' },
  { code: 'OKC', name: 'Will Rogers World Airport',     city: 'Oklahoma City',   country: 'US', lat: 35.39,  lon: -97.60,   population: 1.4,  tier: 'regional' },
  { code: 'TUL', name: 'Tulsa Intl',                    city: 'Tulsa',           country: 'US', lat: 36.20,  lon: -95.89,   population: 1.0,  tier: 'regional' },
  { code: 'GSP', name: 'Greenville-Spartanburg Intl',   city: 'Greenville',      country: 'US', lat: 34.90,  lon: -82.22,   population: 0.9,  tier: 'regional' },
  { code: 'HNL', name: 'Daniel K. Inouye Intl',         city: 'Honolulu',        country: 'US', lat: 21.33,  lon: -157.92,  population: 1.0,  tier: 'major'    },
  { code: 'OGG', name: 'Kahului Airport',               city: 'Maui',            country: 'US', lat: 20.90,  lon: -156.43,  population: 0.16, tier: 'regional' },
  { code: 'KOA', name: 'Kona Intl',                     city: 'Kona',            country: 'US', lat: 19.74,  lon: -156.05,  population: 0.09, tier: 'regional' },
  { code: 'ANC', name: 'Ted Stevens Anchorage Intl',    city: 'Anchorage',       country: 'US', lat: 61.17,  lon: -149.99,  population: 0.4,  tier: 'regional' },
  { code: 'SJU', name: 'Luis Munoz Marin Intl',         city: 'San Juan',        country: 'PR', lat: 18.44,  lon: -66.00,   population: 2.4,  tier: 'regional' },
  { code: 'YYC', name: 'Calgary Intl',                  city: 'Calgary',         country: 'CA', lat: 51.13,  lon: -114.01,  population: 1.6,  tier: 'regional' },
  { code: 'YEG', name: 'Edmonton Intl',                 city: 'Edmonton',        country: 'CA', lat: 53.31,  lon: -113.58,  population: 1.4,  tier: 'regional' },
  { code: 'YWG', name: 'Winnipeg Richardson Intl',      city: 'Winnipeg',        country: 'CA', lat: 49.91,  lon: -97.24,   population: 0.8,  tier: 'regional' },
  { code: 'YHZ', name: 'Halifax Stanfield Intl',        city: 'Halifax',         country: 'CA', lat: 44.88,  lon: -63.51,   population: 0.4,  tier: 'regional' },
  { code: 'YOW', name: 'Ottawa Macdonald-Cartier Intl', city: 'Ottawa',          country: 'CA', lat: 45.32,  lon: -75.67,   population: 1.4,  tier: 'regional' },
  { code: 'YQB', name: 'Quebec City Jean Lesage Intl',  city: 'Quebec City',     country: 'CA', lat: 46.79,  lon: -71.39,   population: 0.8,  tier: 'regional' },
  { code: 'MTY', name: 'Monterrey Mariano Escobedo Intl', city: 'Monterrey',     country: 'MX', lat: 25.78,  lon: -100.11,  population: 5.3,  tier: 'regional' },
  { code: 'TIJ', name: 'Tijuana Intl',                  city: 'Tijuana',         country: 'MX', lat: 32.54,  lon: -116.97,  population: 2.0,  tier: 'regional' },
  { code: 'PVR', name: 'Puerto Vallarta Intl',          city: 'Puerto Vallarta', country: 'MX', lat: 20.68,  lon: -105.25,  population: 0.4,  tier: 'regional' },
  { code: 'SJD', name: 'Los Cabos Intl',                city: 'Los Cabos',       country: 'MX', lat: 23.15,  lon: -109.72,  population: 0.3,  tier: 'regional' },
  { code: 'MID', name: 'Merida Intl',                   city: 'Merida',          country: 'MX', lat: 20.94,  lon: -89.66,   population: 1.1,  tier: 'regional' },
  { code: 'BJX', name: 'Del Bajio Intl',                city: 'Leon',            country: 'MX', lat: 20.99,  lon: -101.48,  population: 1.6,  tier: 'regional' },
  { code: 'HAV', name: 'Jose Marti Intl',               city: 'Havana',          country: 'CU', lat: 22.99,  lon: -82.41,   population: 2.1,  tier: 'regional' },
  { code: 'SDQ', name: 'Las Americas Intl',             city: 'Santo Domingo',   country: 'DO', lat: 18.43,  lon: -69.67,   population: 3.3,  tier: 'regional' },
  { code: 'MBJ', name: 'Sangster Intl',                 city: 'Montego Bay',     country: 'JM', lat: 18.50,  lon: -77.91,   population: 0.12, tier: 'regional' },
  { code: 'KIN', name: 'Norman Manley Intl',            city: 'Kingston',        country: 'JM', lat: 17.94,  lon: -76.79,   population: 0.6,  tier: 'regional' },
  { code: 'NAS', name: 'Lynden Pindling Intl',          city: 'Nassau',          country: 'BS', lat: 25.04,  lon: -77.47,   population: 0.27, tier: 'regional' },
  { code: 'BGI', name: 'Grantley Adams Intl',           city: 'Bridgetown',      country: 'BB', lat: 13.07,  lon: -59.49,   population: 0.09, tier: 'regional' },
  { code: 'SXM', name: 'Princess Juliana Intl',         city: 'Sint Maarten',    country: 'SX', lat: 18.04,  lon: -63.11,   population: 0.04, tier: 'regional' },
  { code: 'POS', name: 'Piarco Intl',                   city: 'Port of Spain',   country: 'TT', lat: 10.60,  lon: -61.34,   population: 0.54, tier: 'regional' },
  { code: 'GCM', name: 'Owen Roberts Intl',             city: 'Grand Cayman',    country: 'KY', lat: 19.29,  lon: -81.36,   population: 0.07, tier: 'regional' },
  { code: 'BDA', name: 'L.F. Wade Intl',                city: 'Hamilton',        country: 'BM', lat: 32.36,  lon: -64.68,   population: 0.06, tier: 'regional' },
  { code: 'SAL', name: 'Monsenor Oscar Arnulfo Romero Intl', city: 'San Salvador', country: 'SV', lat: 13.44, lon: -89.05,  population: 2.4,  tier: 'regional' },
  { code: 'GUA', name: 'La Aurora Intl',                city: 'Guatemala City',  country: 'GT', lat: 14.58,  lon: -90.53,   population: 3.0,  tier: 'regional' },
  { code: 'SAP', name: 'Ramon Villeda Morales Intl',    city: 'San Pedro Sula',  country: 'HN', lat: 15.45,  lon: -87.92,   population: 1.3,  tier: 'regional' },
  { code: 'MGA', name: 'Augusto C. Sandino Intl',       city: 'Managua',         country: 'NI', lat: 12.14,  lon: -86.17,   population: 1.4,  tier: 'regional' },
  { code: 'SJO', name: 'Juan Santamaria Intl',          city: 'San Jose',        country: 'CR', lat: 9.99,   lon: -84.21,   population: 1.4,  tier: 'regional' },

  // ── SOUTH AMERICA (additional) ───────────────────────────────────────────────
  { code: 'FOR', name: 'Pinto Martins Intl',            city: 'Fortaleza',       country: 'BR', lat: -3.78,  lon: -38.53,   population: 4.1,  tier: 'regional' },
  { code: 'SSA', name: 'Deputado Luis Eduardo Magalhaes Intl', city: 'Salvador', country: 'BR', lat: -12.91, lon: -38.33,   population: 4.0,  tier: 'regional' },
  { code: 'REC', name: 'Recife Guararapes Intl',        city: 'Recife',          country: 'BR', lat: -8.13,  lon: -34.92,   population: 4.1,  tier: 'regional' },
  { code: 'POA', name: 'Salgado Filho Intl',            city: 'Porto Alegre',    country: 'BR', lat: -29.99, lon: -51.17,   population: 4.3,  tier: 'regional' },
  { code: 'CWB', name: 'Afonso Pena Intl',              city: 'Curitiba',        country: 'BR', lat: -25.53, lon: -49.18,   population: 3.7,  tier: 'regional' },
  { code: 'MAO', name: 'Eduardo Gomes Intl',            city: 'Manaus',          country: 'BR', lat: -3.04,  lon: -60.05,   population: 2.2,  tier: 'regional' },
  { code: 'MDE', name: 'Jose Maria Cordova Intl',       city: 'Medellin',        country: 'CO', lat: 6.17,   lon: -75.43,   population: 4.0,  tier: 'regional' },
  { code: 'CLO', name: 'Alfonso Bonilla Aragon Intl',   city: 'Cali',            country: 'CO', lat: 3.54,   lon: -76.38,   population: 2.8,  tier: 'regional' },
  { code: 'CTG', name: 'Rafael Nunez Intl',             city: 'Cartagena',       country: 'CO', lat: 10.44,  lon: -75.51,   population: 1.0,  tier: 'regional' },
  { code: 'UIO', name: 'Mariscal Sucre Intl',           city: 'Quito',           country: 'EC', lat: -0.13,  lon: -78.36,   population: 2.8,  tier: 'regional' },
  { code: 'GYE', name: 'Jose Joaquin de Olmedo Intl',   city: 'Guayaquil',       country: 'EC', lat: -2.16,  lon: -79.88,   population: 2.7,  tier: 'regional' },
  { code: 'ASU', name: 'Silvio Pettirossi Intl',        city: 'Asuncion',        country: 'PY', lat: -25.24, lon: -57.52,   population: 2.3,  tier: 'regional' },
  { code: 'MVD', name: 'Carrasco Intl',                 city: 'Montevideo',      country: 'UY', lat: -34.84, lon: -56.03,   population: 1.8,  tier: 'regional' },
  { code: 'CCS', name: 'Simon Bolivar Intl',            city: 'Caracas',         country: 'VE', lat: 10.60,  lon: -66.99,   population: 5.2,  tier: 'regional' },
  { code: 'LPB', name: 'El Alto Intl',                  city: 'La Paz',          country: 'BO', lat: -16.51, lon: -68.19,   population: 1.8,  tier: 'regional' },
  { code: 'VVI', name: 'Viru Viru Intl',                city: 'Santa Cruz',      country: 'BO', lat: -17.65, lon: -63.13,   population: 1.7,  tier: 'regional' },
  { code: 'CUR', name: 'Hato Intl',                     city: 'Willemstad',      country: 'CW', lat: 12.19,  lon: -68.96,   population: 0.15, tier: 'regional' },
  { code: 'PBM', name: 'Johan Adolf Pengel Intl',       city: 'Paramaribo',      country: 'SR', lat: 5.45,   lon: -55.19,   population: 0.6,  tier: 'regional' },
  { code: 'BEL', name: 'Val de Cans Intl',              city: 'Belem',           country: 'BR', lat: -1.38,  lon: -48.48,   population: 2.5,  tier: 'regional' },
  { code: 'CGH', name: 'Congonhas Airport',             city: 'Sao Paulo',       country: 'BR', lat: -23.63, lon: -46.66,   population: 22.4, tier: 'major'    },

  // ── EUROPE (additional) ──────────────────────────────────────────────────────
  { code: 'LGW', name: 'Gatwick Airport',               city: 'London',          country: 'GB', lat: 51.15,  lon: -0.18,    population: 9.3,  tier: 'major'    },
  { code: 'LCY', name: 'London City Airport',           city: 'London',          country: 'GB', lat: 51.51,  lon: 0.05,     population: 9.3,  tier: 'regional' },
  { code: 'STN', name: 'Stansted Airport',              city: 'London',          country: 'GB', lat: 51.89,  lon: 0.24,     population: 9.3,  tier: 'regional' },
  { code: 'MAN', name: 'Manchester Airport',            city: 'Manchester',      country: 'GB', lat: 53.36,  lon: -2.27,    population: 2.8,  tier: 'major'    },
  { code: 'BHX', name: 'Birmingham Airport',            city: 'Birmingham',      country: 'GB', lat: 52.45,  lon: -1.74,    population: 2.6,  tier: 'regional' },
  { code: 'EDI', name: 'Edinburgh Airport',             city: 'Edinburgh',       country: 'GB', lat: 55.95,  lon: -3.37,    population: 0.5,  tier: 'regional' },
  { code: 'GLA', name: 'Glasgow Airport',               city: 'Glasgow',         country: 'GB', lat: 55.87,  lon: -4.43,    population: 1.0,  tier: 'regional' },
  { code: 'BRS', name: 'Bristol Airport',               city: 'Bristol',         country: 'GB', lat: 51.38,  lon: -2.72,    population: 0.7,  tier: 'regional' },
  { code: 'NCL', name: 'Newcastle Airport',             city: 'Newcastle',       country: 'GB', lat: 55.04,  lon: -1.69,    population: 0.9,  tier: 'regional' },
  { code: 'BFS', name: 'Belfast Intl',                  city: 'Belfast',         country: 'GB', lat: 54.66,  lon: -6.22,    population: 0.34, tier: 'regional' },
  { code: 'ORY', name: 'Paris Orly',                    city: 'Paris',           country: 'FR', lat: 48.72,  lon: 2.36,     population: 11.0, tier: 'major'    },
  { code: 'LYS', name: 'Lyon Saint-Exupery',           city: 'Lyon',            country: 'FR', lat: 45.72,  lon: 5.08,     population: 1.7,  tier: 'regional' },
  { code: 'NCE', name: 'Nice Cote d Azur',              city: 'Nice',            country: 'FR', lat: 43.66,  lon: 7.21,     population: 1.0,  tier: 'regional' },
  { code: 'MRS', name: 'Marseille Provence',            city: 'Marseille',       country: 'FR', lat: 43.44,  lon: 5.22,     population: 1.8,  tier: 'regional' },
  { code: 'TLS', name: 'Toulouse Blagnac',              city: 'Toulouse',        country: 'FR', lat: 43.63,  lon: 1.37,     population: 1.0,  tier: 'regional' },
  { code: 'NTE', name: 'Nantes Atlantique',             city: 'Nantes',          country: 'FR', lat: 47.15,  lon: -1.61,    population: 0.9,  tier: 'regional' },
  { code: 'BOD', name: 'Bordeaux Merignac',             city: 'Bordeaux',        country: 'FR', lat: 44.83,  lon: -0.72,    population: 0.9,  tier: 'regional' },
  { code: 'BER', name: 'Berlin Brandenburg',            city: 'Berlin',          country: 'DE', lat: 52.37,  lon: 13.50,    population: 3.8,  tier: 'major'    },
  { code: 'HAM', name: 'Hamburg Airport',               city: 'Hamburg',         country: 'DE', lat: 53.63,  lon: 10.00,    population: 1.8,  tier: 'regional' },
  { code: 'DUS', name: 'Dusseldorf Airport',            city: 'Dusseldorf',      country: 'DE', lat: 51.29,  lon: 6.77,     population: 1.0,  tier: 'regional' },
  { code: 'CGN', name: 'Cologne Bonn Airport',          city: 'Cologne',         country: 'DE', lat: 50.87,  lon: 7.14,     population: 1.1,  tier: 'regional' },
  { code: 'STR', name: 'Stuttgart Airport',             city: 'Stuttgart',       country: 'DE', lat: 48.69,  lon: 9.22,     population: 0.6,  tier: 'regional' },
  { code: 'NUE', name: 'Nuremberg Airport',             city: 'Nuremberg',       country: 'DE', lat: 49.49,  lon: 11.08,    population: 0.5,  tier: 'regional' },
  { code: 'VLC', name: 'Valencia Airport',              city: 'Valencia',        country: 'ES', lat: 39.49,  lon: -0.48,    population: 0.8,  tier: 'regional' },
  { code: 'SVQ', name: 'Sevilla Airport',               city: 'Seville',         country: 'ES', lat: 37.42,  lon: -5.89,    population: 1.5,  tier: 'regional' },
  { code: 'AGP', name: 'Malaga Costa del Sol',          city: 'Malaga',          country: 'ES', lat: 36.67,  lon: -4.50,    population: 0.57, tier: 'regional' },
  { code: 'PMI', name: 'Palma de Mallorca Airport',     city: 'Palma',           country: 'ES', lat: 39.55,  lon: 2.74,     population: 0.47, tier: 'regional' },
  { code: 'TFS', name: 'Tenerife South Airport',        city: 'Tenerife',        country: 'ES', lat: 28.04,  lon: -16.57,   population: 0.9,  tier: 'regional' },
  { code: 'LPA', name: 'Gran Canaria Airport',          city: 'Las Palmas',      country: 'ES', lat: 27.93,  lon: -15.39,   population: 0.38, tier: 'regional' },
  { code: 'IBZ', name: 'Ibiza Airport',                 city: 'Ibiza',           country: 'ES', lat: 38.87,  lon: 1.37,     population: 0.14, tier: 'regional' },
  { code: 'BIO', name: 'Bilbao Airport',                city: 'Bilbao',          country: 'ES', lat: 43.30,  lon: -2.91,    population: 1.0,  tier: 'regional' },
  { code: 'OPO', name: 'Porto Airport',                 city: 'Porto',           country: 'PT', lat: 41.24,  lon: -8.68,    population: 1.7,  tier: 'regional' },
  { code: 'FAO', name: 'Faro Airport',                  city: 'Faro',            country: 'PT', lat: 37.01,  lon: -7.97,    population: 0.12, tier: 'regional' },
  { code: 'FNC', name: 'Madeira Airport',               city: 'Funchal',         country: 'PT', lat: 32.70,  lon: -16.78,   population: 0.11, tier: 'regional' },
  { code: 'NAP', name: 'Naples Intl',                   city: 'Naples',          country: 'IT', lat: 40.89,  lon: 14.29,    population: 3.1,  tier: 'regional' },
  { code: 'VCE', name: 'Venice Marco Polo',             city: 'Venice',          country: 'IT', lat: 45.50,  lon: 12.35,    population: 0.26, tier: 'regional' },
  { code: 'BLQ', name: 'Bologna Guglielmo Marconi',     city: 'Bologna',         country: 'IT', lat: 44.53,  lon: 11.29,    population: 0.39, tier: 'regional' },
  { code: 'CTA', name: 'Catania Fontanarossa',          city: 'Catania',         country: 'IT', lat: 37.47,  lon: 15.07,    population: 0.31, tier: 'regional' },
  { code: 'PMO', name: 'Falcone Borsellino Airport',    city: 'Palermo',         country: 'IT', lat: 38.18,  lon: 13.09,    population: 0.67, tier: 'regional' },
  { code: 'PSA', name: 'Pisa Galileo Galilei',          city: 'Pisa',            country: 'IT', lat: 43.68,  lon: 10.39,    population: 0.09, tier: 'regional' },
  { code: 'LIN', name: 'Milan Linate',                  city: 'Milan',           country: 'IT', lat: 45.45,  lon: 9.28,     population: 3.2,  tier: 'regional' },
  { code: 'TRN', name: 'Turin Caselle Airport',         city: 'Turin',           country: 'IT', lat: 45.20,  lon: 7.65,     population: 0.87, tier: 'regional' },
  { code: 'PRG', name: 'Vaclav Havel Airport Prague',   city: 'Prague',          country: 'CZ', lat: 50.10,  lon: 14.26,    population: 1.3,  tier: 'regional' },
  { code: 'BUD', name: 'Budapest Ferenc Liszt Intl',    city: 'Budapest',        country: 'HU', lat: 47.43,  lon: 19.26,    population: 1.8,  tier: 'regional' },
  { code: 'OTP', name: 'Henri Coanda Intl',             city: 'Bucharest',       country: 'RO', lat: 44.57,  lon: 26.10,    population: 2.3,  tier: 'regional' },
  { code: 'SOF', name: 'Sofia Airport',                 city: 'Sofia',           country: 'BG', lat: 42.70,  lon: 23.41,    population: 1.3,  tier: 'regional' },
  { code: 'ZAG', name: 'Zagreb Airport',                city: 'Zagreb',          country: 'HR', lat: 45.74,  lon: 16.07,    population: 0.8,  tier: 'regional' },
  { code: 'DBV', name: 'Dubrovnik Airport',             city: 'Dubrovnik',       country: 'HR', lat: 42.56,  lon: 18.27,    population: 0.04, tier: 'regional' },
  { code: 'SPU', name: 'Split Airport',                 city: 'Split',           country: 'HR', lat: 43.54,  lon: 16.30,    population: 0.18, tier: 'regional' },
  { code: 'BEG', name: 'Belgrade Nikola Tesla Airport', city: 'Belgrade',        country: 'RS', lat: 44.82,  lon: 20.31,    population: 1.7,  tier: 'regional' },
  { code: 'LJU', name: 'Ljubljana Joze Pucnik Airport', city: 'Ljubljana',       country: 'SI', lat: 46.22,  lon: 14.46,    population: 0.27, tier: 'regional' },
  { code: 'SKP', name: 'Skopje Intl',                   city: 'Skopje',          country: 'MK', lat: 41.96,  lon: 21.62,    population: 0.54, tier: 'regional' },
  { code: 'TIA', name: 'Tirana Rinas Mother Teresa',    city: 'Tirana',          country: 'AL', lat: 41.41,  lon: 19.72,    population: 0.5,  tier: 'regional' },
  { code: 'BTS', name: 'Bratislava Airport',            city: 'Bratislava',      country: 'SK', lat: 48.17,  lon: 17.21,    population: 0.48, tier: 'regional' },
  { code: 'KBP', name: 'Kyiv Boryspil Intl',           city: 'Kyiv',            country: 'UA', lat: 50.35,  lon: 30.89,    population: 3.1,  tier: 'regional' },
  { code: 'LWO', name: 'Lviv Danylo Halytskyi Intl',   city: 'Lviv',            country: 'UA', lat: 49.81,  lon: 23.96,    population: 0.72, tier: 'regional' },
  { code: 'MSQ', name: 'Minsk National Airport',        city: 'Minsk',           country: 'BY', lat: 53.88,  lon: 28.03,    population: 2.0,  tier: 'regional' },
  { code: 'TLL', name: 'Tallinn Airport',               city: 'Tallinn',         country: 'EE', lat: 59.41,  lon: 24.83,    population: 0.44, tier: 'regional' },
  { code: 'RIX', name: 'Riga Intl',                     city: 'Riga',            country: 'LV', lat: 56.92,  lon: 23.97,    population: 0.63, tier: 'regional' },
  { code: 'VNO', name: 'Vilnius Airport',               city: 'Vilnius',         country: 'LT', lat: 54.63,  lon: 25.29,    population: 0.57, tier: 'regional' },
  { code: 'SVO', name: 'Moscow Sheremetyevo Intl',      city: 'Moscow',          country: 'RU', lat: 55.97,  lon: 37.41,    population: 12.4, tier: 'mega'     },
  { code: 'DME', name: 'Moscow Domodedovo Intl',        city: 'Moscow',          country: 'RU', lat: 55.41,  lon: 37.90,    population: 12.4, tier: 'major'    },
  { code: 'LED', name: 'St. Petersburg Pulkovo',        city: 'St. Petersburg',  country: 'RU', lat: 59.80,  lon: 30.26,    population: 5.4,  tier: 'regional' },
  { code: 'AER', name: 'Sochi Intl',                    city: 'Sochi',           country: 'RU', lat: 43.45,  lon: 39.96,    population: 0.4,  tier: 'regional' },
  { code: 'SVX', name: 'Yekaterinburg Koltsovo',        city: 'Yekaterinburg',   country: 'RU', lat: 56.84,  lon: 60.80,    population: 1.5,  tier: 'regional' },
  { code: 'OVB', name: 'Novosibirsk Tolmachevo',        city: 'Novosibirsk',     country: 'RU', lat: 54.97,  lon: 82.65,    population: 1.6,  tier: 'regional' },
  { code: 'VKO', name: 'Moscow Vnukovo',                city: 'Moscow',          country: 'RU', lat: 55.60,  lon: 37.26,    population: 12.4, tier: 'major'    },
  { code: 'KEF', name: 'Keflavik Intl',                 city: 'Reykjavik',       country: 'IS', lat: 63.99,  lon: -22.62,   population: 0.22, tier: 'regional' },
  { code: 'GOT', name: 'Gothenburg Landvetter',         city: 'Gothenburg',      country: 'SE', lat: 57.66,  lon: 12.29,    population: 0.57, tier: 'regional' },
  { code: 'BGO', name: 'Bergen Flesland',               city: 'Bergen',          country: 'NO', lat: 60.29,  lon: 5.22,     population: 0.28, tier: 'regional' },
  { code: 'TRD', name: 'Trondheim Vaernes',             city: 'Trondheim',       country: 'NO', lat: 63.46,  lon: 10.92,    population: 0.19, tier: 'regional' },
  { code: 'AAL', name: 'Aalborg Airport',               city: 'Aalborg',         country: 'DK', lat: 57.09,  lon: 9.85,     population: 0.12, tier: 'regional' },
  { code: 'HER', name: 'Heraklion Nikos Kazantzakis',   city: 'Heraklion',       country: 'GR', lat: 35.34,  lon: 25.18,    population: 0.17, tier: 'regional' },
  { code: 'RHO', name: 'Rhodes Diagoras Airport',       city: 'Rhodes',          country: 'GR', lat: 36.41,  lon: 28.08,    population: 0.12, tier: 'regional' },
  { code: 'JTR', name: 'Santorini Thira Airport',       city: 'Santorini',       country: 'GR', lat: 36.40,  lon: 25.48,    population: 0.02, tier: 'regional' },
  { code: 'JMK', name: 'Mykonos Airport',               city: 'Mykonos',         country: 'GR', lat: 37.43,  lon: 25.35,    population: 0.01, tier: 'regional' },
  { code: 'CHQ', name: 'Chania Intl',                   city: 'Chania',          country: 'GR', lat: 35.53,  lon: 24.15,    population: 0.11, tier: 'regional' },
  { code: 'SKG', name: 'Thessaloniki Macedonia Airport',city: 'Thessaloniki',    country: 'GR', lat: 40.52,  lon: 22.97,    population: 1.1,  tier: 'regional' },
  { code: 'AYT', name: 'Antalya Airport',               city: 'Antalya',         country: 'TR', lat: 36.90,  lon: 30.80,    population: 2.4,  tier: 'regional' },
  { code: 'ADB', name: 'Izmir Adnan Menderes',          city: 'Izmir',           country: 'TR', lat: 38.29,  lon: 27.16,    population: 4.3,  tier: 'regional' },
  { code: 'ESB', name: 'Ankara Esenboga Intl',          city: 'Ankara',          country: 'TR', lat: 40.13,  lon: 32.99,    population: 5.7,  tier: 'regional' },
  { code: 'DLM', name: 'Dalaman Airport',               city: 'Dalaman',         country: 'TR', lat: 36.71,  lon: 28.79,    population: 0.08, tier: 'regional' },
  { code: 'SAW', name: 'Istanbul Sabiha Gokcen Intl',   city: 'Istanbul',        country: 'TR', lat: 40.90,  lon: 29.31,    population: 15.6, tier: 'major'    },

  // ── MIDDLE EAST (additional) ─────────────────────────────────────────────────
  { code: 'JED', name: 'King Abdulaziz Intl',           city: 'Jeddah',          country: 'SA', lat: 21.66,  lon: 39.16,    population: 4.8,  tier: 'major'    },
  { code: 'DMM', name: 'King Fahd Intl',                city: 'Dammam',          country: 'SA', lat: 26.47,  lon: 49.80,    population: 1.2,  tier: 'regional' },
  { code: 'MED', name: 'Prince Mohammad bin Abdulaziz', city: 'Medina',          country: 'SA', lat: 24.55,  lon: 39.71,    population: 1.5,  tier: 'regional' },
  { code: 'KWI', name: 'Kuwait Intl',                   city: 'Kuwait City',     country: 'KW', lat: 29.23,  lon: 47.97,    population: 3.1,  tier: 'regional' },
  { code: 'BAH', name: 'Bahrain Intl',                  city: 'Manama',          country: 'BH', lat: 26.27,  lon: 50.63,    population: 0.63, tier: 'regional' },
  { code: 'MCT', name: 'Muscat Intl',                   city: 'Muscat',          country: 'OM', lat: 23.59,  lon: 58.28,    population: 1.6,  tier: 'regional' },
  { code: 'SHJ', name: 'Sharjah Intl',                  city: 'Sharjah',         country: 'AE', lat: 25.33,  lon: 55.52,    population: 1.4,  tier: 'regional' },
  { code: 'BEY', name: 'Beirut Rafic Hariri Intl',      city: 'Beirut',          country: 'LB', lat: 33.82,  lon: 35.49,    population: 2.2,  tier: 'regional' },
  { code: 'AMM', name: 'Queen Alia Intl',               city: 'Amman',           country: 'JO', lat: 31.72,  lon: 35.99,    population: 2.1,  tier: 'regional' },
  { code: 'BGW', name: 'Baghdad Intl',                  city: 'Baghdad',         country: 'IQ', lat: 33.26,  lon: 44.23,    population: 8.1,  tier: 'regional' },
  { code: 'IKA', name: 'Tehran Imam Khomeini Intl',     city: 'Tehran',          country: 'IR', lat: 35.42,  lon: 51.15,    population: 15.8, tier: 'major'    },
  { code: 'MHD', name: 'Mashhad Shahid Hasheminejad',   city: 'Mashhad',         country: 'IR', lat: 36.24,  lon: 59.64,    population: 3.4,  tier: 'regional' },
  { code: 'GYD', name: 'Heydar Aliyev Intl',            city: 'Baku',            country: 'AZ', lat: 40.47,  lon: 50.04,    population: 2.3,  tier: 'regional' },
  { code: 'TBS', name: 'Tbilisi Intl',                  city: 'Tbilisi',         country: 'GE', lat: 41.67,  lon: 44.95,    population: 1.2,  tier: 'regional' },
  { code: 'EVN', name: 'Zvartnots Intl',                city: 'Yerevan',         country: 'AM', lat: 40.15,  lon: 44.40,    population: 1.2,  tier: 'regional' },
  { code: 'TAS', name: 'Tashkent Yunus Akhunbabayev',   city: 'Tashkent',        country: 'UZ', lat: 41.26,  lon: 69.28,    population: 2.9,  tier: 'regional' },
  { code: 'ALA', name: 'Almaty Intl',                   city: 'Almaty',          country: 'KZ', lat: 43.35,  lon: 77.04,    population: 2.0,  tier: 'regional' },
  { code: 'NQZ', name: 'Astana Intl',                   city: 'Nur-Sultan',      country: 'KZ', lat: 51.02,  lon: 71.47,    population: 1.2,  tier: 'regional' },
  { code: 'FRU', name: 'Manas Intl',                    city: 'Bishkek',         country: 'KG', lat: 43.06,  lon: 74.48,    population: 1.1,  tier: 'regional' },
  { code: 'ASB', name: 'Ashgabat Intl',                 city: 'Ashgabat',        country: 'TM', lat: 37.99,  lon: 58.36,    population: 0.9,  tier: 'regional' },
  { code: 'DYU', name: 'Dushanbe Intl',                 city: 'Dushanbe',        country: 'TJ', lat: 38.54,  lon: 68.82,    population: 0.8,  tier: 'regional' },
  { code: 'KBL', name: 'Hamid Karzai Intl',             city: 'Kabul',           country: 'AF', lat: 34.56,  lon: 69.21,    population: 4.6,  tier: 'regional' },
  { code: 'KHI', name: 'Jinnah Intl',                   city: 'Karachi',         country: 'PK', lat: 24.91,  lon: 67.16,    population: 16.1, tier: 'major'    },
  { code: 'LHE', name: 'Allama Iqbal Intl',             city: 'Lahore',          country: 'PK', lat: 31.52,  lon: 74.40,    population: 13.1, tier: 'major'    },
  { code: 'ISB', name: 'Islamabad Intl',                city: 'Islamabad',       country: 'PK', lat: 33.55,  lon: 72.84,    population: 2.2,  tier: 'regional' },

  // ── AFRICA (additional) ──────────────────────────────────────────────────────
  { code: 'ALG', name: 'Houari Boumediene Airport',     city: 'Algiers',         country: 'DZ', lat: 36.69,  lon: 3.22,     population: 3.4,  tier: 'regional' },
  { code: 'TUN', name: 'Tunis Carthage Intl',           city: 'Tunis',           country: 'TN', lat: 36.85,  lon: 10.23,    population: 2.5,  tier: 'regional' },
  { code: 'TIP', name: 'Tripoli Intl',                  city: 'Tripoli',         country: 'LY', lat: 32.66,  lon: 13.15,    population: 1.2,  tier: 'regional' },
  { code: 'KRT', name: 'Khartoum Intl',                 city: 'Khartoum',        country: 'SD', lat: 15.60,  lon: 32.55,    population: 6.2,  tier: 'regional' },
  { code: 'HRG', name: 'Hurghada Intl',                 city: 'Hurghada',        country: 'EG', lat: 27.18,  lon: 33.80,    population: 0.25, tier: 'regional' },
  { code: 'SSH', name: 'Sharm el-Sheikh Intl',          city: 'Sharm el-Sheikh', country: 'EG', lat: 27.98,  lon: 34.40,    population: 0.06, tier: 'regional' },
  { code: 'ABV', name: 'Nnamdi Azikiwe Intl',           city: 'Abuja',           country: 'NG', lat: 9.01,   lon: 7.26,     population: 3.6,  tier: 'regional' },
  { code: 'PHC', name: 'Port Harcourt Intl',            city: 'Port Harcourt',   country: 'NG', lat: 5.01,   lon: 6.95,     population: 2.7,  tier: 'regional' },
  { code: 'ACC', name: 'Kotoka Intl',                   city: 'Accra',           country: 'GH', lat: 5.60,   lon: -0.17,    population: 3.6,  tier: 'regional' },
  { code: 'ABJ', name: 'Felix Houphouet-Boigny Intl',   city: 'Abidjan',         country: 'CI', lat: 5.26,   lon: -3.93,    population: 5.2,  tier: 'regional' },
  { code: 'DKR', name: 'Blaise Diagne Intl',            city: 'Dakar',           country: 'SN', lat: 14.67,  lon: -17.07,   population: 3.7,  tier: 'regional' },
  { code: 'BKO', name: 'Senou Intl',                    city: 'Bamako',          country: 'ML', lat: 12.53,  lon: -7.95,    population: 2.7,  tier: 'regional' },
  { code: 'OUA', name: 'Ouagadougou Airport',           city: 'Ouagadougou',     country: 'BF', lat: 12.35,  lon: -1.51,    population: 2.7,  tier: 'regional' },
  { code: 'NIM', name: 'Diori Hamani Intl',             city: 'Niamey',          country: 'NE', lat: 13.48,  lon: 2.18,     population: 1.3,  tier: 'regional' },
  { code: 'NDJ', name: 'Hassan Djamous Intl',           city: "N'Djamena",       country: 'TD', lat: 12.13,  lon: 15.03,    population: 1.4,  tier: 'regional' },
  { code: 'LFW', name: 'Lome Tokoin Airport',           city: 'Lome',            country: 'TG', lat: 6.17,   lon: 1.25,     population: 1.5,  tier: 'regional' },
  { code: 'COO', name: 'Cadjehoun Airport',             city: 'Cotonou',         country: 'BJ', lat: 6.36,   lon: 2.38,     population: 0.76, tier: 'regional' },
  { code: 'FIH', name: 'N\'Djili Intl',                 city: 'Kinshasa',        country: 'CD', lat: -4.39,  lon: 15.44,    population: 14.3, tier: 'major'    },
  { code: 'DLA', name: 'Douala Intl',                   city: 'Douala',          country: 'CM', lat: 4.01,   lon: 9.72,     population: 3.8,  tier: 'regional' },
  { code: 'YAO', name: 'Yaounde Nsimalen Intl',         city: 'Yaounde',         country: 'CM', lat: 3.72,   lon: 11.55,    population: 2.9,  tier: 'regional' },
  { code: 'LBV', name: 'Leon M\'Ba Intl',               city: 'Libreville',      country: 'GA', lat: 0.46,   lon: 9.41,     population: 0.70, tier: 'regional' },
  { code: 'BZV', name: 'Maya-Maya Airport',             city: 'Brazzaville',     country: 'CG', lat: -4.25,  lon: 15.25,    population: 2.3,  tier: 'regional' },
  { code: 'DAR', name: 'Julius Nyerere Intl',           city: 'Dar es Salaam',   country: 'TZ', lat: -6.88,  lon: 39.20,    population: 6.7,  tier: 'regional' },
  { code: 'JRO', name: 'Kilimanjaro Intl',              city: 'Arusha',          country: 'TZ', lat: -3.43,  lon: 37.07,    population: 0.42, tier: 'regional' },
  { code: 'EBB', name: 'Entebbe Intl',                  city: 'Kampala',         country: 'UG', lat: 0.04,   lon: 32.44,    population: 3.6,  tier: 'regional' },
  { code: 'KGL', name: 'Kigali Intl',                   city: 'Kigali',          country: 'RW', lat: -1.97,  lon: 30.14,    population: 1.1,  tier: 'regional' },
  { code: 'HRE', name: 'Robert Gabriel Mugabe Intl',    city: 'Harare',          country: 'ZW', lat: -17.93, lon: 31.10,    population: 2.2,  tier: 'regional' },
  { code: 'LLW', name: 'Kamuzu Intl',                   city: 'Lilongwe',        country: 'MW', lat: -13.79, lon: 33.78,    population: 0.99, tier: 'regional' },
  { code: 'MPM', name: 'Maputo Intl',                   city: 'Maputo',          country: 'MZ', lat: -25.92, lon: 32.57,    population: 1.8,  tier: 'regional' },
  { code: 'WDH', name: 'Hosea Kutako Intl',             city: 'Windhoek',        country: 'NA', lat: -22.48, lon: 17.47,    population: 0.43, tier: 'regional' },
  { code: 'GBE', name: 'Sir Seretse Khama Intl',        city: 'Gaborone',        country: 'BW', lat: -24.56, lon: 25.92,    population: 0.27, tier: 'regional' },
  { code: 'TNR', name: 'Ivato Intl',                    city: 'Antananarivo',    country: 'MG', lat: -18.80, lon: 47.48,    population: 3.6,  tier: 'regional' },
  { code: 'MRU', name: 'Sir Seewoosagur Ramgoolam Intl',city: 'Port Louis',      country: 'MU', lat: -20.43, lon: 57.68,    population: 0.15, tier: 'regional' },
  { code: 'DUR', name: 'King Shaka Intl',               city: 'Durban',          country: 'ZA', lat: -29.61, lon: 31.12,    population: 3.7,  tier: 'regional' },
  { code: 'LUN', name: 'Kenneth Kaunda Intl',           city: 'Lusaka',          country: 'ZM', lat: -15.33, lon: 28.45,    population: 2.5,  tier: 'regional' },

  // ── SOUTH ASIA (additional) ──────────────────────────────────────────────────
  { code: 'HYD', name: 'Rajiv Gandhi Intl',             city: 'Hyderabad',       country: 'IN', lat: 17.23,  lon: 78.43,    population: 10.5, tier: 'major'    },
  { code: 'MAA', name: 'Chennai Intl',                  city: 'Chennai',         country: 'IN', lat: 12.99,  lon: 80.18,    population: 10.9, tier: 'major'    },
  { code: 'CCU', name: 'Netaji Subhas Chandra Bose Intl',city: 'Kolkata',        country: 'IN', lat: 22.65,  lon: 88.45,    population: 14.9, tier: 'major'    },
  { code: 'AMD', name: 'Sardar Vallabhbhai Patel Intl', city: 'Ahmedabad',       country: 'IN', lat: 23.07,  lon: 72.63,    population: 8.0,  tier: 'regional' },
  { code: 'PNQ', name: 'Pune Airport',                  city: 'Pune',            country: 'IN', lat: 18.58,  lon: 73.92,    population: 7.4,  tier: 'regional' },
  { code: 'GOI', name: 'Goa Dabolim Airport',           city: 'Goa',             country: 'IN', lat: 15.38,  lon: 73.83,    population: 0.11, tier: 'regional' },
  { code: 'COK', name: 'Cochin Intl',                   city: 'Kochi',           country: 'IN', lat: 10.15,  lon: 76.40,    population: 2.1,  tier: 'regional' },
  { code: 'JAI', name: 'Jaipur Intl',                   city: 'Jaipur',          country: 'IN', lat: 26.82,  lon: 75.81,    population: 3.1,  tier: 'regional' },
  { code: 'LKO', name: 'Chaudhary Charan Singh Intl',   city: 'Lucknow',         country: 'IN', lat: 26.76,  lon: 80.89,    population: 3.5,  tier: 'regional' },
  { code: 'KTM', name: 'Tribhuvan Intl',                city: 'Kathmandu',       country: 'NP', lat: 27.70,  lon: 85.36,    population: 1.4,  tier: 'regional' },
  { code: 'DAC', name: 'Hazrat Shahjalal Intl',         city: 'Dhaka',           country: 'BD', lat: 23.84,  lon: 90.40,    population: 22.5, tier: 'major'    },
  { code: 'CGP', name: 'Shah Amanat Intl',              city: 'Chittagong',      country: 'BD', lat: 22.25,  lon: 91.81,    population: 5.0,  tier: 'regional' },
  { code: 'RGN', name: 'Yangon Intl',                   city: 'Yangon',          country: 'MM', lat: 16.91,  lon: 96.13,    population: 7.4,  tier: 'regional' },
  { code: 'HAN', name: 'Noi Bai Intl',                  city: 'Hanoi',           country: 'VN', lat: 21.22,  lon: 105.81,   population: 8.5,  tier: 'major'    },
  { code: 'SGN', name: 'Tan Son Nhat Intl',             city: 'Ho Chi Minh City',country: 'VN', lat: 10.82,  lon: 106.66,   population: 13.0, tier: 'major'    },
  { code: 'DAD', name: 'Da Nang Intl',                  city: 'Da Nang',         country: 'VN', lat: 16.04,  lon: 108.20,   population: 1.2,  tier: 'regional' },
  { code: 'PNH', name: 'Phnom Penh Intl',               city: 'Phnom Penh',      country: 'KH', lat: 11.55,  lon: 104.84,   population: 2.3,  tier: 'regional' },
  { code: 'REP', name: 'Siem Reap Intl',                city: 'Siem Reap',       country: 'KH', lat: 13.41,  lon: 103.81,   population: 0.25, tier: 'regional' },
  { code: 'VTE', name: 'Wattay Intl',                   city: 'Vientiane',       country: 'LA', lat: 17.99,  lon: 102.56,   population: 0.96, tier: 'regional' },

  // ── SOUTHEAST ASIA (additional) ──────────────────────────────────────────────
  { code: 'DPS', name: 'Ngurah Rai Intl',               city: 'Bali',            country: 'ID', lat: -8.75,  lon: 115.17,   population: 1.7,  tier: 'major'    },
  { code: 'SUB', name: 'Juanda Intl',                   city: 'Surabaya',        country: 'ID', lat: -7.38,  lon: 112.79,   population: 9.7,  tier: 'major'    },
  { code: 'UPG', name: 'Sultan Hasanuddin Intl',        city: 'Makassar',        country: 'ID', lat: -5.06,  lon: 119.55,   population: 1.9,  tier: 'regional' },
  { code: 'KNO', name: 'Kuala Namu Intl',               city: 'Medan',           country: 'ID', lat: 3.64,   lon: 98.89,    population: 4.1,  tier: 'regional' },
  { code: 'BPN', name: 'Sultan Aji Muhammad Sulaiman',  city: 'Balikpapan',      country: 'ID', lat: -1.27,  lon: 116.89,   population: 0.8,  tier: 'regional' },
  { code: 'PEN', name: 'Penang Intl',                   city: 'Penang',          country: 'MY', lat: 5.30,   lon: 100.28,   population: 1.8,  tier: 'regional' },
  { code: 'BKI', name: 'Kota Kinabalu Intl',            city: 'Kota Kinabalu',   country: 'MY', lat: 5.94,   lon: 116.05,   population: 0.72, tier: 'regional' },
  { code: 'KCH', name: 'Kuching Intl',                  city: 'Kuching',         country: 'MY', lat: 1.48,   lon: 110.34,   population: 0.73, tier: 'regional' },
  { code: 'JHB', name: 'Senai Intl',                    city: 'Johor Bahru',     country: 'MY', lat: 1.64,   lon: 103.67,   population: 1.8,  tier: 'regional' },
  { code: 'BWN', name: 'Brunei Intl',                   city: 'Bandar Seri Begawan', country: 'BN', lat: 4.94, lon: 114.93,  population: 0.28, tier: 'regional' },
  { code: 'CEB', name: 'Mactan-Cebu Intl',              city: 'Cebu',            country: 'PH', lat: 10.31,  lon: 123.98,   population: 2.9,  tier: 'regional' },
  { code: 'DVO', name: 'Francisco Bangoy Intl',         city: 'Davao',           country: 'PH', lat: 7.13,   lon: 125.65,   population: 2.1,  tier: 'regional' },
  { code: 'ILO', name: 'Iloilo Intl',                   city: 'Iloilo',          country: 'PH', lat: 10.83,  lon: 122.49,   population: 1.0,  tier: 'regional' },
  { code: 'DMK', name: 'Don Mueang Intl',               city: 'Bangkok',         country: 'TH', lat: 13.91,  lon: 100.61,   population: 15.7, tier: 'major'    },
  { code: 'CNX', name: 'Chiang Mai Intl',               city: 'Chiang Mai',      country: 'TH', lat: 18.77,  lon: 98.96,    population: 1.0,  tier: 'regional' },
  { code: 'HKT', name: 'Phuket Intl',                   city: 'Phuket',          country: 'TH', lat: 8.11,   lon: 98.32,    population: 0.38, tier: 'regional' },
  { code: 'USM', name: 'Samui Airport',                 city: 'Ko Samui',        country: 'TH', lat: 9.55,   lon: 100.06,   population: 0.06, tier: 'regional' },

  // ── EAST ASIA (additional) ───────────────────────────────────────────────────
  { code: 'PKX', name: 'Beijing Daxing Intl',           city: 'Beijing',         country: 'CN', lat: 39.51,  lon: 116.41,   population: 21.5, tier: 'mega'     },
  { code: 'SHA', name: 'Shanghai Hongqiao Intl',        city: 'Shanghai',        country: 'CN', lat: 31.20,  lon: 121.34,   population: 27.1, tier: 'major'    },
  { code: 'CKG', name: 'Chongqing Jiangbei Intl',       city: 'Chongqing',       country: 'CN', lat: 29.72,  lon: 106.64,   population: 8.8,  tier: 'major'    },
  { code: 'WUH', name: 'Wuhan Tianhe Intl',             city: 'Wuhan',           country: 'CN', lat: 30.78,  lon: 114.21,   population: 8.2,  tier: 'major'    },
  { code: 'XIY', name: "Xi'an Xianyang Intl",           city: "Xi'an",           country: 'CN', lat: 34.45,  lon: 108.75,   population: 8.1,  tier: 'major'    },
  { code: 'KMG', name: 'Kunming Changshui Intl',        city: 'Kunming',         country: 'CN', lat: 25.10,  lon: 102.93,   population: 7.2,  tier: 'major'    },
  { code: 'HGH', name: 'Hangzhou Xiaoshan Intl',        city: 'Hangzhou',        country: 'CN', lat: 30.23,  lon: 120.43,   population: 7.8,  tier: 'major'    },
  { code: 'NKG', name: 'Nanjing Lukou Intl',            city: 'Nanjing',         country: 'CN', lat: 31.74,  lon: 118.87,   population: 8.5,  tier: 'major'    },
  { code: 'XMN', name: 'Xiamen Gaoqi Intl',             city: 'Xiamen',          country: 'CN', lat: 24.54,  lon: 118.13,   population: 4.9,  tier: 'regional' },
  { code: 'TAO', name: 'Qingdao Jiaodong Intl',         city: 'Qingdao',         country: 'CN', lat: 36.36,  lon: 120.31,   population: 9.4,  tier: 'regional' },
  { code: 'HRB', name: 'Harbin Taiping Intl',           city: 'Harbin',          country: 'CN', lat: 45.62,  lon: 126.25,   population: 5.3,  tier: 'regional' },
  { code: 'SHE', name: 'Shenyang Taoxian Intl',         city: 'Shenyang',        country: 'CN', lat: 41.64,  lon: 123.49,   population: 6.9,  tier: 'regional' },
  { code: 'DLC', name: 'Dalian Zhoushuizi Intl',        city: 'Dalian',          country: 'CN', lat: 38.97,  lon: 121.54,   population: 3.4,  tier: 'regional' },
  { code: 'TNA', name: 'Jinan Yaoqiang Intl',           city: 'Jinan',           country: 'CN', lat: 36.86,  lon: 117.22,   population: 7.4,  tier: 'regional' },
  { code: 'CSX', name: 'Changsha Huanghua Intl',        city: 'Changsha',        country: 'CN', lat: 28.19,  lon: 113.22,   population: 8.0,  tier: 'regional' },
  { code: 'NNG', name: 'Nanning Wuxu Intl',             city: 'Nanning',         country: 'CN', lat: 22.61,  lon: 108.17,   population: 4.9,  tier: 'regional' },
  { code: 'URC', name: 'Urumqi Diwopu Intl',            city: 'Urumqi',          country: 'CN', lat: 43.91,  lon: 87.47,    population: 3.5,  tier: 'regional' },
  { code: 'MFM', name: 'Macau Intl',                    city: 'Macau',           country: 'MO', lat: 22.15,  lon: 113.59,   population: 0.68, tier: 'regional' },
  { code: 'GMP', name: 'Seoul Gimpo Intl',              city: 'Seoul',           country: 'KR', lat: 37.56,  lon: 126.80,   population: 9.8,  tier: 'major'    },
  { code: 'PUS', name: 'Gimhae Intl',                   city: 'Busan',           country: 'KR', lat: 35.18,  lon: 128.94,   population: 3.4,  tier: 'regional' },
  { code: 'CJU', name: 'Jeju Intl',                     city: 'Jeju',            country: 'KR', lat: 33.51,  lon: 126.49,   population: 0.67, tier: 'regional' },
  { code: 'TAE', name: 'Daegu Intl',                    city: 'Daegu',           country: 'KR', lat: 35.90,  lon: 128.66,   population: 2.5,  tier: 'regional' },
  { code: 'CTS', name: 'New Chitose Airport',           city: 'Sapporo',         country: 'JP', lat: 42.77,  lon: 141.69,   population: 2.7,  tier: 'regional' },
  { code: 'NGO', name: 'Chubu Centrair Intl',           city: 'Nagoya',          country: 'JP', lat: 34.86,  lon: 136.81,   population: 9.1,  tier: 'major'    },
  { code: 'ITM', name: 'Osaka Itami Airport',           city: 'Osaka',           country: 'JP', lat: 34.78,  lon: 135.44,   population: 19.3, tier: 'major'    },
  { code: 'OKA', name: 'Naha Airport',                  city: 'Okinawa',         country: 'JP', lat: 26.20,  lon: 127.65,   population: 0.32, tier: 'regional' },
  { code: 'SDJ', name: 'Sendai Airport',                city: 'Sendai',          country: 'JP', lat: 38.14,  lon: 140.92,   population: 1.1,  tier: 'regional' },
  { code: 'FUK', name: 'Fukuoka Airport',               city: 'Fukuoka',         country: 'JP', lat: 33.58,  lon: 130.45,   population: 2.7,  tier: 'regional' },
  { code: 'KHH', name: 'Kaohsiung Intl',                city: 'Kaohsiung',       country: 'TW', lat: 22.58,  lon: 120.35,   population: 2.8,  tier: 'regional' },
  { code: 'TSA', name: 'Taipei Songshan Airport',       city: 'Taipei',          country: 'TW', lat: 25.07,  lon: 121.55,   population: 7.0,  tier: 'regional' },
  { code: 'RMQ', name: 'Taichung Intl',                 city: 'Taichung',        country: 'TW', lat: 24.26,  lon: 120.62,   population: 2.8,  tier: 'regional' },

  // ── OCEANIA (additional) ─────────────────────────────────────────────────────
  { code: 'PER', name: 'Perth Airport',                 city: 'Perth',           country: 'AU', lat: -31.94, lon: 115.97,   population: 2.1,  tier: 'major'    },
  { code: 'ADL', name: 'Adelaide Airport',              city: 'Adelaide',        country: 'AU', lat: -34.95, lon: 138.53,   population: 1.4,  tier: 'regional' },
  { code: 'CBR', name: 'Canberra Airport',              city: 'Canberra',        country: 'AU', lat: -35.31, lon: 149.20,   population: 0.45, tier: 'regional' },
  { code: 'CNS', name: 'Cairns Airport',                city: 'Cairns',          country: 'AU', lat: -16.89, lon: 145.75,   population: 0.25, tier: 'regional' },
  { code: 'OOL', name: 'Gold Coast Airport',            city: 'Gold Coast',      country: 'AU', lat: -28.17, lon: 153.50,   population: 0.69, tier: 'regional' },
  { code: 'HBA', name: 'Hobart Airport',                city: 'Hobart',          country: 'AU', lat: -42.84, lon: 147.51,   population: 0.24, tier: 'regional' },
  { code: 'DRW', name: 'Darwin Intl',                   city: 'Darwin',          country: 'AU', lat: -12.41, lon: 130.88,   population: 0.15, tier: 'regional' },
  { code: 'CHC', name: 'Christchurch Intl',             city: 'Christchurch',    country: 'NZ', lat: -43.49, lon: 172.53,   population: 0.40, tier: 'regional' },
  { code: 'WLG', name: 'Wellington Intl',               city: 'Wellington',      country: 'NZ', lat: -41.33, lon: 174.81,   population: 0.42, tier: 'regional' },
  { code: 'ZQN', name: 'Queenstown Airport',            city: 'Queenstown',      country: 'NZ', lat: -45.02, lon: 168.74,   population: 0.04, tier: 'regional' },
  { code: 'PPT', name: 'Faa\'a Intl',                   city: 'Papeete',         country: 'PF', lat: -17.55, lon: -149.61,  population: 0.19, tier: 'regional' },
  { code: 'NOU', name: 'La Tontouta Intl',              city: 'Noumea',          country: 'NC', lat: -22.01, lon: 166.21,   population: 0.18, tier: 'regional' },
  { code: 'NAN', name: 'Nadi Intl',                     city: 'Nadi',            country: 'FJ', lat: -17.76, lon: 177.44,   population: 0.10, tier: 'regional' },
  { code: 'SUV', name: 'Nausori Intl',                  city: 'Suva',            country: 'FJ', lat: -18.04, lon: 178.56,   population: 0.09, tier: 'regional' },
  { code: 'POM', name: 'Jacksons Intl',                 city: 'Port Moresby',    country: 'PG', lat: -9.44,  lon: 147.22,   population: 0.37, tier: 'regional' },
  { code: 'HIR', name: 'Honiara Intl',                  city: 'Honiara',         country: 'SB', lat: -9.43,  lon: 160.05,   population: 0.08, tier: 'regional' },
  { code: 'VLI', name: 'Bauerfield Intl',               city: 'Port Vila',       country: 'VU', lat: -17.70, lon: 168.32,   population: 0.05, tier: 'regional' },
  { code: 'GUM', name: 'Antonio B. Won Pat Intl',       city: 'Hagatna',         country: 'GU', lat: 13.48,  lon: 144.80,   population: 0.17, tier: 'regional' },
  { code: 'RAR', name: 'Rarotonga Intl',                city: 'Avarua',          country: 'CK', lat: -21.20, lon: -159.81,  population: 0.02, tier: 'regional' },
  // ── ADDITIONAL AIRPORTS ─────────────────────────────────────────────────────
  { code: 'ALB', name: 'Albany Intl', city: 'Albany', country: 'US', lat: 42.75, lon: -73.8, population: 0.9, tier: 'regional' },
  { code: 'AMA', name: 'Rick Husband Amarillo Intl', city: 'Amarillo', country: 'US', lat: 35.22, lon: -101.71, population: 0.3, tier: 'regional' },
  { code: 'ASE', name: 'Aspen/Pitkin County Airport', city: 'Aspen', country: 'US', lat: 39.22, lon: -106.87, population: 0.07, tier: 'regional' },
  { code: 'AVL', name: 'Asheville Regional', city: 'Asheville', country: 'US', lat: 35.44, lon: -82.54, population: 0.5, tier: 'regional' },
  { code: 'AVP', name: 'Wilkes-Barre/Scranton Intl', city: 'Scranton', country: 'US', lat: 41.34, lon: -75.72, population: 0.6, tier: 'regional' },
  { code: 'AZO', name: 'Kalamazoo/Battle Creek Intl', city: 'Kalamazoo', country: 'US', lat: 42.23, lon: -85.55, population: 0.5, tier: 'regional' },
  { code: 'BFL', name: 'Meadows Field', city: 'Bakersfield', country: 'US', lat: 35.43, lon: -119.06, population: 0.9, tier: 'regional' },
  { code: 'BGM', name: 'Greater Binghamton Airport', city: 'Binghamton', country: 'US', lat: 42.21, lon: -75.98, population: 0.2, tier: 'regional' },
  { code: 'BIL', name: 'Billings Logan Intl', city: 'Billings', country: 'US', lat: 45.81, lon: -108.54, population: 0.2, tier: 'regional' },
  { code: 'BIS', name: 'Bismarck Municipal', city: 'Bismarck', country: 'US', lat: 46.77, lon: -100.75, population: 0.1, tier: 'regional' },
  { code: 'BTR', name: 'Baton Rouge Metro', city: 'Baton Rouge', country: 'US', lat: 30.53, lon: -91.15, population: 0.8, tier: 'regional' },
  { code: 'BTV', name: 'Burlington Intl', city: 'Burlington VT', country: 'US', lat: 44.47, lon: -73.15, population: 0.2, tier: 'regional' },
  { code: 'BUF', name: 'Buffalo Niagara Intl', city: 'Buffalo', country: 'US', lat: 42.94, lon: -78.73, population: 1.2, tier: 'regional' },
  { code: 'CAE', name: 'Columbia Metropolitan', city: 'Columbia SC', country: 'US', lat: 33.94, lon: -81.12, population: 0.8, tier: 'regional' },
  { code: 'CAK', name: 'Akron-Canton Regional', city: 'Akron', country: 'US', lat: 40.92, lon: -81.44, population: 0.7, tier: 'regional' },
  { code: 'CHA', name: 'Chattanooga Metropolitan', city: 'Chattanooga', country: 'US', lat: 35.04, lon: -85.2, population: 0.6, tier: 'regional' },
  { code: 'CHS', name: 'Charleston Intl', city: 'Charleston SC', country: 'US', lat: 32.9, lon: -80.04, population: 0.8, tier: 'regional' },
  { code: 'CID', name: 'Eastern Iowa Airport', city: 'Cedar Rapids', country: 'US', lat: 41.88, lon: -91.71, population: 0.3, tier: 'regional' },
  { code: 'COS', name: 'Colorado Springs Airport', city: 'Colorado Springs', country: 'US', lat: 38.81, lon: -104.7, population: 0.7, tier: 'regional' },
  { code: 'CPR', name: 'Casper/Natrona County Intl', city: 'Casper', country: 'US', lat: 42.91, lon: -106.46, population: 0.1, tier: 'regional' },
  { code: 'CRP', name: 'Corpus Christi Intl', city: 'Corpus Christi', country: 'US', lat: 27.77, lon: -97.5, population: 0.4, tier: 'regional' },
  { code: 'CVG', name: 'Cincinnati/Northern KY Intl', city: 'Cincinnati', country: 'US', lat: 39.05, lon: -84.67, population: 2.2, tier: 'regional' },
  { code: 'DAB', name: 'Daytona Beach Intl', city: 'Daytona Beach', country: 'US', lat: 29.18, lon: -81.06, population: 0.6, tier: 'regional' },
  { code: 'DAL', name: 'Dallas Love Field', city: 'Dallas', country: 'US', lat: 32.85, lon: -96.85, population: 7.7, tier: 'regional' },
  { code: 'DAY', name: 'Dayton Intl', city: 'Dayton', country: 'US', lat: 39.9, lon: -84.22, population: 0.8, tier: 'regional' },
  { code: 'DLH', name: 'Duluth Intl', city: 'Duluth', country: 'US', lat: 46.84, lon: -92.19, population: 0.1, tier: 'regional' },
  { code: 'EUG', name: 'Eugene Airport', city: 'Eugene', country: 'US', lat: 44.12, lon: -123.22, population: 0.4, tier: 'regional' },
  { code: 'EVV', name: 'Evansville Regional', city: 'Evansville', country: 'US', lat: 38.04, lon: -87.53, population: 0.3, tier: 'regional' },
  { code: 'FAI', name: 'Fairbanks Intl', city: 'Fairbanks', country: 'US', lat: 64.82, lon: -147.86, population: 0.1, tier: 'regional' },
  { code: 'FAR', name: 'Hector Intl', city: 'Fargo', country: 'US', lat: 46.92, lon: -96.82, population: 0.2, tier: 'regional' },
  { code: 'FAT', name: 'Fresno Yosemite Intl', city: 'Fresno', country: 'US', lat: 36.78, lon: -119.72, population: 1.0, tier: 'regional' },
  { code: 'FCA', name: 'Glacier Park Intl', city: 'Kalispell', country: 'US', lat: 48.31, lon: -114.26, population: 0.1, tier: 'regional' },
  { code: 'FNT', name: 'Bishop Intl', city: 'Flint', country: 'US', lat: 42.97, lon: -83.74, population: 0.4, tier: 'regional' },
  { code: 'FSD', name: 'Sioux Falls Regional', city: 'Sioux Falls', country: 'US', lat: 43.58, lon: -96.74, population: 0.3, tier: 'regional' },
  { code: 'FWA', name: 'Fort Wayne Intl', city: 'Fort Wayne', country: 'US', lat: 40.98, lon: -85.2, population: 0.4, tier: 'regional' },
  { code: 'GJT', name: 'Grand Junction Regional', city: 'Grand Junction', country: 'US', lat: 39.12, lon: -108.53, population: 0.2, tier: 'regional' },
  { code: 'GPT', name: 'Gulfport-Biloxi Intl', city: 'Gulfport', country: 'US', lat: 30.41, lon: -89.07, population: 0.4, tier: 'regional' },
  { code: 'GRB', name: 'Green Bay Austin Straubel', city: 'Green Bay', country: 'US', lat: 44.49, lon: -88.13, population: 0.3, tier: 'regional' },
  { code: 'GRR', name: 'Gerald R. Ford Intl', city: 'Grand Rapids', country: 'US', lat: 42.88, lon: -85.52, population: 1.1, tier: 'regional' },
  { code: 'GSO', name: 'Piedmont Triad Intl', city: 'Greensboro', country: 'US', lat: 36.1, lon: -79.94, population: 1.6, tier: 'regional' },
  { code: 'GTF', name: 'Great Falls Intl', city: 'Great Falls', country: 'US', lat: 47.48, lon: -111.37, population: 0.1, tier: 'regional' },
  { code: 'HPN', name: 'Westchester County', city: 'White Plains', country: 'US', lat: 41.07, lon: -73.71, population: 20.1, tier: 'regional' },
  { code: 'HRL', name: 'Valley Intl', city: 'Harlingen', country: 'US', lat: 26.23, lon: -97.65, population: 0.4, tier: 'regional' },
  { code: 'HSV', name: 'Huntsville Intl', city: 'Huntsville', country: 'US', lat: 34.64, lon: -86.78, population: 0.5, tier: 'regional' },
  { code: 'ICT', name: 'Wichita Eisenhower Natl', city: 'Wichita', country: 'US', lat: 37.65, lon: -97.43, population: 0.6, tier: 'regional' },
  { code: 'IDA', name: 'Idaho Falls Regional', city: 'Idaho Falls', country: 'US', lat: 43.51, lon: -112.07, population: 0.1, tier: 'regional' },
  { code: 'ILM', name: 'Wilmington Intl', city: 'Wilmington NC', country: 'US', lat: 34.27, lon: -77.9, population: 0.4, tier: 'regional' },
  { code: 'JAC', name: 'Jackson Hole Airport', city: 'Jackson Hole', country: 'US', lat: 43.61, lon: -110.74, population: 0.03, tier: 'regional' },
  { code: 'JAN', name: 'Jackson-Medgar Wiley Evers', city: 'Jackson MS', country: 'US', lat: 32.31, lon: -90.08, population: 0.6, tier: 'regional' },
  { code: 'JNU', name: 'Juneau Intl', city: 'Juneau', country: 'US', lat: 58.36, lon: -134.58, population: 0.03, tier: 'regional' },
  { code: 'LAW', name: 'Lawton-Fort Sill Regional', city: 'Lawton', country: 'US', lat: 34.57, lon: -98.42, population: 0.1, tier: 'regional' },
  { code: 'LBB', name: 'Lubbock Preston Smith Intl', city: 'Lubbock', country: 'US', lat: 33.66, lon: -101.82, population: 0.3, tier: 'regional' },
  { code: 'LEX', name: 'Blue Grass Airport', city: 'Lexington', country: 'US', lat: 38.04, lon: -84.61, population: 0.5, tier: 'regional' },
  { code: 'LFT', name: 'Lafayette Regional', city: 'Lafayette LA', country: 'US', lat: 30.21, lon: -91.99, population: 0.3, tier: 'regional' },
  { code: 'LGB', name: 'Long Beach Airport', city: 'Long Beach', country: 'US', lat: 33.82, lon: -118.15, population: 13.2, tier: 'regional' },
  { code: 'LIT', name: 'Clinton National Airport', city: 'Little Rock', country: 'US', lat: 34.73, lon: -92.22, population: 0.7, tier: 'regional' },
  { code: 'LNK', name: 'Lincoln Airport', city: 'Lincoln NE', country: 'US', lat: 40.85, lon: -96.76, population: 0.3, tier: 'regional' },
  { code: 'MAF', name: 'Midland Intl Air and Space', city: 'Midland TX', country: 'US', lat: 31.94, lon: -102.2, population: 0.3, tier: 'regional' },
  { code: 'MDT', name: 'Harrisburg Intl', city: 'Harrisburg', country: 'US', lat: 40.19, lon: -76.76, population: 0.6, tier: 'regional' },
  { code: 'MLB', name: 'Melbourne Orlando Intl', city: 'Melbourne FL', country: 'US', lat: 28.1, lon: -80.64, population: 0.8, tier: 'regional' },
  { code: 'MLI', name: 'Quad City Intl', city: 'Moline', country: 'US', lat: 41.45, lon: -90.51, population: 0.4, tier: 'regional' },
  { code: 'MOB', name: 'Mobile Regional', city: 'Mobile', country: 'US', lat: 30.69, lon: -88.24, population: 0.6, tier: 'regional' },
  { code: 'MOT', name: 'Minot Intl', city: 'Minot', country: 'US', lat: 48.26, lon: -101.28, population: 0.07, tier: 'regional' },
  { code: 'MRY', name: 'Monterey Regional', city: 'Monterey', country: 'US', lat: 36.59, lon: -121.84, population: 0.4, tier: 'regional' },
  { code: 'MSN', name: 'Dane County Regional', city: 'Madison WI', country: 'US', lat: 43.14, lon: -89.34, population: 0.7, tier: 'regional' },
  { code: 'MTJ', name: 'Montrose Regional', city: 'Montrose CO', country: 'US', lat: 38.51, lon: -107.9, population: 0.05, tier: 'regional' },
  { code: 'MYR', name: 'Myrtle Beach Intl', city: 'Myrtle Beach', country: 'US', lat: 33.68, lon: -78.93, population: 0.5, tier: 'regional' },
  { code: 'OAJ', name: 'Albert J. Ellis Airport', city: 'Jacksonville NC', country: 'US', lat: 34.83, lon: -77.61, population: 0.2, tier: 'regional' },
  { code: 'PFN', name: 'Northwest Florida Beaches Intl', city: 'Panama City FL', country: 'US', lat: 30.21, lon: -85.68, population: 0.2, tier: 'regional' },
  { code: 'PIE', name: 'St. Pete-Clearwater Intl', city: 'St. Petersburg', country: 'US', lat: 27.91, lon: -82.69, population: 3.2, tier: 'regional' },
  { code: 'PNS', name: 'Pensacola Intl', city: 'Pensacola', country: 'US', lat: 30.47, lon: -87.19, population: 0.5, tier: 'regional' },
  { code: 'PWM', name: 'Portland Intl Jetport', city: 'Portland ME', country: 'US', lat: 43.65, lon: -70.31, population: 0.5, tier: 'regional' },
  { code: 'RAP', name: 'Rapid City Regional', city: 'Rapid City', country: 'US', lat: 44.05, lon: -103.06, population: 0.1, tier: 'regional' },
  { code: 'ROA', name: 'Roanoke-Blacksburg Regional', city: 'Roanoke', country: 'US', lat: 37.33, lon: -79.97, population: 0.3, tier: 'regional' },
  { code: 'ROC', name: 'Greater Rochester Intl', city: 'Rochester NY', country: 'US', lat: 43.12, lon: -77.67, population: 1.1, tier: 'regional' },
  { code: 'RST', name: 'Rochester Intl', city: 'Rochester MN', country: 'US', lat: 43.91, lon: -92.5, population: 0.2, tier: 'regional' },
  { code: 'SAV', name: 'Savannah/Hilton Head Intl', city: 'Savannah', country: 'US', lat: 32.13, lon: -81.2, population: 0.4, tier: 'regional' },
  { code: 'SBA', name: 'Santa Barbara Municipal', city: 'Santa Barbara', country: 'US', lat: 34.43, lon: -119.84, population: 0.4, tier: 'regional' },
  { code: 'SBN', name: 'South Bend Intl', city: 'South Bend', country: 'US', lat: 41.71, lon: -86.32, population: 0.3, tier: 'regional' },
  { code: 'SHV', name: 'Shreveport Regional', city: 'Shreveport', country: 'US', lat: 32.45, lon: -93.83, population: 0.4, tier: 'regional' },
  { code: 'SPI', name: 'Abraham Lincoln Capital', city: 'Springfield IL', country: 'US', lat: 39.84, lon: -89.68, population: 0.2, tier: 'regional' },
  { code: 'SRQ', name: 'Sarasota-Bradenton Intl', city: 'Sarasota', country: 'US', lat: 27.4, lon: -82.55, population: 0.8, tier: 'regional' },
  { code: 'SUX', name: 'Sioux Gateway Airport', city: 'Sioux City', country: 'US', lat: 42.4, lon: -96.38, population: 0.1, tier: 'regional' },
  { code: 'SWF', name: 'Stewart Intl', city: 'Newburgh NY', country: 'US', lat: 41.5, lon: -74.1, population: 20.1, tier: 'regional' },
  { code: 'SYR', name: 'Syracuse Hancock Intl', city: 'Syracuse', country: 'US', lat: 43.11, lon: -76.11, population: 0.7, tier: 'regional' },
  { code: 'TLH', name: 'Tallahassee Intl', city: 'Tallahassee', country: 'US', lat: 30.4, lon: -84.35, population: 0.4, tier: 'regional' },
  { code: 'TOL', name: 'Toledo Express Airport', city: 'Toledo', country: 'US', lat: 41.59, lon: -83.81, population: 0.7, tier: 'regional' },
  { code: 'TRI', name: 'Tri-Cities Regional', city: 'Kingsport TN', country: 'US', lat: 36.48, lon: -82.41, population: 0.5, tier: 'regional' },
  { code: 'TYS', name: 'McGhee Tyson Airport', city: 'Knoxville', country: 'US', lat: 35.81, lon: -83.99, population: 0.9, tier: 'regional' },
  { code: 'XNA', name: 'Northwest Arkansas Natl', city: 'Fayetteville AR', country: 'US', lat: 36.28, lon: -94.31, population: 0.6, tier: 'regional' },
  { code: 'YKM', name: 'Yakima Air Terminal', city: 'Yakima', country: 'US', lat: 46.57, lon: -120.54, population: 0.1, tier: 'regional' },
  { code: 'ATW', name: 'Appleton Intl', city: 'Appleton WI', country: 'US', lat: 44.26, lon: -88.52, population: 0.3, tier: 'regional' },
  { code: 'EAU', name: 'Chippewa Valley Regional', city: 'Eau Claire WI', country: 'US', lat: 44.87, lon: -91.48, population: 0.2, tier: 'regional' },
  { code: 'CWA', name: 'Central Wisconsin Airport', city: 'Wausau WI', country: 'US', lat: 44.78, lon: -89.67, population: 0.1, tier: 'regional' },
  { code: 'DBQ', name: 'Dubuque Regional Airport', city: 'Dubuque IA', country: 'US', lat: 42.4, lon: -90.71, population: 0.1, tier: 'regional' },
  { code: 'ALO', name: 'Waterloo Regional Airport', city: 'Waterloo IA', country: 'US', lat: 42.56, lon: -92.4, population: 0.1, tier: 'regional' },
  { code: 'MCW', name: 'Mason City Municipal', city: 'Mason City IA', country: 'US', lat: 43.16, lon: -93.33, population: 0.05, tier: 'regional' },
  { code: 'GFK', name: 'Grand Forks Intl', city: 'Grand Forks ND', country: 'US', lat: 47.95, lon: -97.18, population: 0.1, tier: 'regional' },
  { code: 'MKG', name: 'Muskegon County Airport', city: 'Muskegon MI', country: 'US', lat: 43.17, lon: -86.24, population: 0.2, tier: 'regional' },
  { code: 'TVC', name: 'Cherry Capital Airport', city: 'Traverse City MI', country: 'US', lat: 44.74, lon: -85.58, population: 0.2, tier: 'regional' },
  { code: 'CKB', name: 'North Central WV Airport', city: 'Clarksburg WV', country: 'US', lat: 39.3, lon: -80.23, population: 0.1, tier: 'regional' },
  { code: 'PKB', name: 'Mid-Ohio Valley Regional', city: 'Parkersburg WV', country: 'US', lat: 39.35, lon: -81.44, population: 0.1, tier: 'regional' },
  { code: 'HTS', name: 'Tri-State Airport', city: 'Huntington WV', country: 'US', lat: 38.37, lon: -82.56, population: 0.1, tier: 'regional' },
  { code: 'LYH', name: 'Lynchburg Regional', city: 'Lynchburg VA', country: 'US', lat: 37.33, lon: -79.2, population: 0.1, tier: 'regional' },
  { code: 'CHO', name: 'Charlottesville-Albemarle', city: 'Charlottesville', country: 'US', lat: 38.14, lon: -78.45, population: 0.5, tier: 'regional' },
  { code: 'SBY', name: 'Salisbury-Ocean City Regional', city: 'Salisbury MD', country: 'US', lat: 38.34, lon: -75.51, population: 0.1, tier: 'regional' },
  { code: 'ACY', name: 'Atlantic City Intl', city: 'Atlantic City', country: 'US', lat: 39.46, lon: -74.58, population: 0.3, tier: 'regional' },
  { code: 'ELM', name: 'Elmira/Corning Regional', city: 'Elmira NY', country: 'US', lat: 42.16, lon: -76.89, population: 0.2, tier: 'regional' },
  { code: 'ITH', name: 'Ithaca Tompkins Regional', city: 'Ithaca NY', country: 'US', lat: 42.49, lon: -76.46, population: 0.05, tier: 'regional' },
  { code: 'GRI', name: 'Central Nebraska Regional', city: 'Grand Island NE', country: 'US', lat: 40.97, lon: -98.31, population: 0.1, tier: 'regional' },
  { code: 'GCK', name: 'Garden City Regional', city: 'Garden City KS', country: 'US', lat: 37.93, lon: -100.72, population: 0.05, tier: 'regional' },
  { code: 'LSE', name: 'La Crosse Regional Airport', city: 'La Crosse WI', country: 'US', lat: 43.88, lon: -91.26, population: 0.1, tier: 'regional' },
  { code: 'GTR', name: 'Golden Triangle Regional', city: 'Columbus MS', country: 'US', lat: 33.45, lon: -88.59, population: 0.1, tier: 'regional' },
  { code: 'TUP', name: 'Tupelo Regional Airport', city: 'Tupelo', country: 'US', lat: 34.27, lon: -88.77, population: 0.1, tier: 'regional' },
  { code: 'SHD', name: 'Shenandoah Valley Regional', city: 'Weyers Cave VA', country: 'US', lat: 38.26, lon: -78.9, population: 0.1, tier: 'regional' },
  { code: 'IPT', name: 'Williamsport Regional', city: 'Williamsport PA', country: 'US', lat: 41.24, lon: -76.92, population: 0.1, tier: 'regional' },
  { code: 'HGR', name: 'Hagerstown Regional', city: 'Hagerstown MD', country: 'US', lat: 39.71, lon: -77.73, population: 0.1, tier: 'regional' },
  { code: 'YFC', name: 'Fredericton Intl', city: 'Fredericton', country: 'CA', lat: 45.87, lon: -66.54, population: 0.1, tier: 'regional' },
  { code: 'YHM', name: 'John C. Munro Hamilton Intl', city: 'Hamilton ON', country: 'CA', lat: 43.17, lon: -79.93, population: 0.8, tier: 'regional' },
  { code: 'YKA', name: 'Kamloops Airport', city: 'Kamloops', country: 'CA', lat: 50.7, lon: -120.44, population: 0.1, tier: 'regional' },
  { code: 'YLW', name: 'Kelowna Intl', city: 'Kelowna', country: 'CA', lat: 49.96, lon: -119.38, population: 0.2, tier: 'regional' },
  { code: 'YMM', name: 'Fort McMurray Intl', city: 'Fort McMurray', country: 'CA', lat: 56.65, lon: -111.22, population: 0.07, tier: 'regional' },
  { code: 'YQR', name: 'Regina Intl', city: 'Regina', country: 'CA', lat: 50.43, lon: -104.67, population: 0.2, tier: 'regional' },
  { code: 'YQT', name: 'Thunder Bay Intl', city: 'Thunder Bay', country: 'CA', lat: 48.37, lon: -89.32, population: 0.1, tier: 'regional' },
  { code: 'YSJ', name: 'Saint John Airport', city: 'Saint John NB', country: 'CA', lat: 45.32, lon: -65.89, population: 0.1, tier: 'regional' },
  { code: 'YXE', name: 'John G. Diefenbaker Intl', city: 'Saskatoon', country: 'CA', lat: 52.17, lon: -106.7, population: 0.3, tier: 'regional' },
  { code: 'YXS', name: 'Prince George Airport', city: 'Prince George', country: 'CA', lat: 53.89, lon: -122.68, population: 0.08, tier: 'regional' },
  { code: 'YXU', name: 'London Intl', city: 'London ON', country: 'CA', lat: 43.03, lon: -81.15, population: 0.5, tier: 'regional' },
  { code: 'YYB', name: 'North Bay Jack Garland', city: 'North Bay', country: 'CA', lat: 46.36, lon: -79.42, population: 0.07, tier: 'regional' },
  { code: 'YYJ', name: 'Victoria Intl', city: 'Victoria', country: 'CA', lat: 48.65, lon: -123.43, population: 0.4, tier: 'regional' },
  { code: 'YZF', name: 'Yellowknife Airport', city: 'Yellowknife', country: 'CA', lat: 62.46, lon: -114.44, population: 0.02, tier: 'regional' },
  { code: 'YXY', name: 'Erik Nielsen Whitehorse Intl', city: 'Whitehorse', country: 'CA', lat: 60.71, lon: -135.07, population: 0.04, tier: 'regional' },
  { code: 'AQP', name: 'Rodriguez Ballon Intl', city: 'Arequipa', country: 'PE', lat: -16.34, lon: -71.58, population: 1.1, tier: 'regional' },
  { code: 'BGA', name: 'Palonegro Intl', city: 'Bucaramanga', country: 'CO', lat: 7.13, lon: -73.18, population: 1.3, tier: 'regional' },
  { code: 'BZE', name: 'Philip S.W. Goldson Intl', city: 'Belize City', country: 'BZ', lat: 17.54, lon: -88.31, population: 0.09, tier: 'regional' },
  { code: 'CIX', name: 'Capitan FAP Quiones Intl', city: 'Chiclayo', country: 'PE', lat: -6.79, lon: -79.83, population: 0.9, tier: 'regional' },
  { code: 'CJC', name: 'El Loa Airport', city: 'Calama', country: 'CL', lat: -22.5, lon: -68.9, population: 0.2, tier: 'regional' },
  { code: 'COR', name: 'Ingeniero A. Taravella Intl', city: 'Cordoba', country: 'AR', lat: -31.32, lon: -64.21, population: 1.5, tier: 'regional' },
  { code: 'CUC', name: 'Camilo Daza Intl', city: 'Cucuta', country: 'CO', lat: 7.93, lon: -72.51, population: 0.7, tier: 'regional' },
  { code: 'CUZ', name: 'Alejandro Velasco Astete Intl', city: 'Cusco', country: 'PE', lat: -13.54, lon: -71.94, population: 0.4, tier: 'regional' },
  { code: 'CZM', name: 'Cozumel Intl', city: 'Cozumel', country: 'MX', lat: 20.52, lon: -86.93, population: 0.08, tier: 'regional' },
  { code: 'FLN', name: 'Hercilio Luz Intl', city: 'Florianopolis', country: 'BR', lat: -27.67, lon: -48.55, population: 1.1, tier: 'regional' },
  { code: 'GEO', name: 'Cheddi Jagan Intl', city: 'Georgetown', country: 'GY', lat: 6.5, lon: -58.25, population: 0.3, tier: 'regional' },
  { code: 'GYN', name: 'Santa Genoveva Airport', city: 'Goiania', country: 'BR', lat: -16.63, lon: -49.22, population: 2.5, tier: 'regional' },
  { code: 'IQQ', name: 'Diego Aracena Intl', city: 'Iquique', country: 'CL', lat: -20.53, lon: -70.18, population: 0.3, tier: 'regional' },
  { code: 'IQT', name: 'Coronel FAP Secada Intl', city: 'Iquitos', country: 'PE', lat: -3.78, lon: -73.31, population: 0.5, tier: 'regional' },
  { code: 'MGF', name: 'Regional de Maringa', city: 'Maringa', country: 'BR', lat: -23.48, lon: -52.02, population: 0.7, tier: 'regional' },
  { code: 'NQN', name: 'Presidente Peron Intl', city: 'Neuquen', country: 'AR', lat: -38.95, lon: -68.16, population: 0.3, tier: 'regional' },
  { code: 'PMC', name: 'El Tepual Intl', city: 'Puerto Montt', country: 'CL', lat: -41.44, lon: -73.09, population: 0.3, tier: 'regional' },
  { code: 'POP', name: 'Gregorio Luperon Intl', city: 'Puerto Plata', country: 'DO', lat: 19.76, lon: -70.57, population: 0.3, tier: 'regional' },
  { code: 'PUJ', name: 'Punta Cana Intl', city: 'Punta Cana', country: 'DO', lat: 18.57, lon: -68.36, population: 0.1, tier: 'regional' },
  { code: 'PVH', name: 'Governador J. Canedo Intl', city: 'Porto Velho', country: 'BR', lat: -8.71, lon: -63.9, population: 0.5, tier: 'regional' },
  { code: 'SLP', name: 'Ponciano Arriaga Intl', city: 'San Luis Potosi', country: 'MX', lat: 22.25, lon: -100.93, population: 1.2, tier: 'regional' },
  { code: 'STI', name: 'Cibao Intl', city: 'Santiago DR', country: 'DO', lat: 19.41, lon: -70.6, population: 1.0, tier: 'regional' },
  { code: 'TGU', name: 'Toncontin Intl', city: 'Tegucigalpa', country: 'HN', lat: 14.06, lon: -87.22, population: 1.5, tier: 'regional' },
  { code: 'TRC', name: 'Francisco Sarabia Intl', city: 'Torreon', country: 'MX', lat: 25.57, lon: -103.41, population: 1.5, tier: 'regional' },
  { code: 'VCP', name: 'Campinas Viracopos Intl', city: 'Campinas', country: 'BR', lat: -23.01, lon: -47.13, population: 3.2, tier: 'regional' },
  { code: 'CNF', name: 'Belo Horizonte Confins Intl', city: 'Belo Horizonte', country: 'BR', lat: -19.63, lon: -43.97, population: 6.0, tier: 'major' },
  { code: 'MCZ', name: 'Zumbi dos Palmares Intl', city: 'Maceio', country: 'BR', lat: -9.51, lon: -35.79, population: 1.0, tier: 'regional' },
  { code: 'NAT', name: 'Governador Aloizio Intl', city: 'Natal', country: 'BR', lat: -5.77, lon: -35.38, population: 1.7, tier: 'regional' },
  { code: 'JPA', name: 'Presidente Castro Pinto Intl', city: 'Joao Pessoa', country: 'BR', lat: -7.15, lon: -34.95, population: 1.0, tier: 'regional' },
  { code: 'AJU', name: 'Santa Maria Airport', city: 'Aracaju', country: 'BR', lat: -10.98, lon: -37.07, population: 0.6, tier: 'regional' },
  { code: 'CGB', name: 'Marechal Rondon Intl', city: 'Cuiaba', country: 'BR', lat: -15.65, lon: -56.12, population: 0.7, tier: 'regional' },
  { code: 'IGR', name: 'Cataratas del Iguazu Intl', city: 'Puerto Iguazu', country: 'AR', lat: -25.74, lon: -54.47, population: 0.06, tier: 'regional' },
  { code: 'PMW', name: 'Brigadeiro Lysias Rodrigues', city: 'Palmas', country: 'BR', lat: -10.29, lon: -48.36, population: 0.3, tier: 'regional' },
  { code: 'THE', name: 'Senador Petronion Portella', city: 'Teresina', country: 'BR', lat: -5.06, lon: -42.82, population: 0.9, tier: 'regional' },
  { code: 'MAB', name: 'Joao Correa da Rocha', city: 'Maraba', country: 'BR', lat: -5.37, lon: -49.14, population: 0.2, tier: 'regional' },
  { code: 'UDI', name: 'Ten. Cel. Av. C. Morais Intl', city: 'Uberlandia', country: 'BR', lat: -18.88, lon: -48.23, population: 0.7, tier: 'regional' },
  { code: 'JOI', name: 'Lauro Carneiro de Loyola', city: 'Joinville', country: 'BR', lat: -26.22, lon: -48.8, population: 0.6, tier: 'regional' },
  { code: 'LDB', name: 'Londrina Airport', city: 'Londrina', country: 'BR', lat: -23.33, lon: -51.13, population: 0.6, tier: 'regional' },
  { code: 'XAP', name: 'Serafin Enoss Bertaso', city: 'Chapeco', country: 'BR', lat: -27.13, lon: -52.66, population: 0.2, tier: 'regional' },
  { code: 'MZT', name: 'General Rafael Buelna Intl', city: 'Mazatlan', country: 'MX', lat: 23.16, lon: -106.27, population: 0.5, tier: 'regional' },
  { code: 'ZLO', name: 'Playa de Oro Intl', city: 'Manzanillo MX', country: 'MX', lat: 19.14, lon: -104.56, population: 0.2, tier: 'regional' },
  { code: 'HUX', name: 'Bahias de Huatulco Intl', city: 'Huatulco', country: 'MX', lat: 15.78, lon: -96.26, population: 0.05, tier: 'regional' },
  { code: 'VSA', name: 'Carlos Rovirosa Perez Intl', city: 'Villahermosa', country: 'MX', lat: 17.99, lon: -92.82, population: 0.7, tier: 'regional' },
  { code: 'CME', name: 'Ciudad del Carmen Intl', city: 'Ciudad del Carmen', country: 'MX', lat: 18.65, lon: -91.8, population: 0.2, tier: 'regional' },
  { code: 'MXL', name: 'Gen. Rodolfo Sanchez Intl', city: 'Mexicali', country: 'MX', lat: 32.63, lon: -115.24, population: 1.1, tier: 'regional' },
  { code: 'HMO', name: 'Gen. Ignacio P. Garcia Intl', city: 'Hermosillo', country: 'MX', lat: 29.1, lon: -111.05, population: 1.0, tier: 'regional' },
  { code: 'CUL', name: 'Bachigualato Fed. Intl', city: 'Culiacan', country: 'MX', lat: 24.76, lon: -107.47, population: 1.0, tier: 'regional' },
  { code: 'DGO', name: 'Gen. Guadalupe Victoria Intl', city: 'Durango', country: 'MX', lat: 24.12, lon: -104.53, population: 0.7, tier: 'regional' },
  { code: 'AGU', name: 'Lic. Jesus Teran Peredo Intl', city: 'Aguascalientes', country: 'MX', lat: 21.71, lon: -102.32, population: 1.1, tier: 'regional' },
  { code: 'MLM', name: 'Gen. Francisco J. Mujica Intl', city: 'Morelia', country: 'MX', lat: 19.85, lon: -101.02, population: 0.9, tier: 'regional' },
  { code: 'QRO', name: 'Queretaro Intl', city: 'Queretaro', country: 'MX', lat: 20.62, lon: -100.19, population: 1.1, tier: 'regional' },
  { code: 'TAP', name: 'Tapachula Intl', city: 'Tapachula', country: 'MX', lat: 14.79, lon: -92.37, population: 0.3, tier: 'regional' },
  { code: 'VER', name: 'General Heriberto Jara Intl', city: 'Veracruz', country: 'MX', lat: 19.14, lon: -96.19, population: 0.8, tier: 'regional' },
  { code: 'OAX', name: 'Xoxocotlan Intl', city: 'Oaxaca', country: 'MX', lat: 16.99, lon: -96.73, population: 0.3, tier: 'regional' },
  { code: 'ZCL', name: 'Gen. Leobardo C. Ruiz Intl', city: 'Zacatecas', country: 'MX', lat: 22.9, lon: -102.69, population: 0.3, tier: 'regional' },
  { code: 'CLQ', name: 'Lic. Miguel de la Madrid', city: 'Colima', country: 'MX', lat: 19.28, lon: -103.58, population: 0.4, tier: 'regional' },
  { code: 'RTB', name: 'Roatan Island Airport', city: 'Roatan', country: 'HN', lat: 16.32, lon: -86.52, population: 0.05, tier: 'regional' },
  { code: 'LIR', name: 'Daniel Oduber Quiros Intl', city: 'Liberia CR', country: 'CR', lat: 10.59, lon: -85.54, population: 0.09, tier: 'regional' },
  { code: 'AAR', name: 'Aarhus Airport', city: 'Aarhus', country: 'DK', lat: 56.3, lon: 10.62, population: 0.3, tier: 'regional' },
  { code: 'ABZ', name: 'Aberdeen Intl', city: 'Aberdeen', country: 'GB', lat: 57.2, lon: -2.2, population: 0.3, tier: 'regional' },
  { code: 'ACE', name: 'Lanzarote Airport', city: 'Lanzarote', country: 'ES', lat: 28.95, lon: -13.61, population: 0.15, tier: 'regional' },
  { code: 'AES', name: 'Alesund Airport', city: 'Alesund', country: 'NO', lat: 62.56, lon: 6.12, population: 0.1, tier: 'regional' },
  { code: 'AHO', name: 'Alghero-Fertilia Airport', city: 'Alghero', country: 'IT', lat: 40.63, lon: 8.29, population: 0.04, tier: 'regional' },
  { code: 'AJA', name: 'Ajaccio Napoleon Bonaparte', city: 'Ajaccio', country: 'FR', lat: 41.92, lon: 8.8, population: 0.07, tier: 'regional' },
  { code: 'ALC', name: 'Alicante-Elche Airport', city: 'Alicante', country: 'ES', lat: 38.28, lon: -0.56, population: 0.8, tier: 'regional' },
  { code: 'AOI', name: 'Ancona Falconara Airport', city: 'Ancona', country: 'IT', lat: 43.62, lon: 13.36, population: 0.5, tier: 'regional' },
  { code: 'BDS', name: 'Brindisi Airport', city: 'Brindisi', country: 'IT', lat: 40.66, lon: 17.95, population: 0.2, tier: 'regional' },
  { code: 'BIA', name: 'Bastia-Poretta Airport', city: 'Bastia', country: 'FR', lat: 42.55, lon: 9.49, population: 0.07, tier: 'regional' },
  { code: 'BJV', name: 'Milas-Bodrum Airport', city: 'Bodrum', country: 'TR', lat: 37.25, lon: 27.66, population: 0.1, tier: 'regional' },
  { code: 'BLL', name: 'Billund Airport', city: 'Billund', country: 'DK', lat: 55.74, lon: 9.15, population: 0.05, tier: 'regional' },
  { code: 'BRQ', name: 'Brno-Turany Airport', city: 'Brno', country: 'CZ', lat: 49.15, lon: 16.69, population: 0.4, tier: 'regional' },
  { code: 'CAG', name: 'Cagliari Elmas Airport', city: 'Cagliari', country: 'IT', lat: 39.25, lon: 9.06, population: 0.4, tier: 'regional' },
  { code: 'CFU', name: 'Corfu Intl', city: 'Corfu', country: 'GR', lat: 39.6, lon: 19.91, population: 0.1, tier: 'regional' },
  { code: 'CIA', name: 'Rome Ciampino Airport', city: 'Rome', country: 'IT', lat: 41.8, lon: 12.59, population: 4.3, tier: 'regional' },
  { code: 'CRL', name: 'Brussels South Charleroi', city: 'Charleroi', country: 'BE', lat: 50.46, lon: 4.45, population: 0.5, tier: 'regional' },
  { code: 'DRS', name: 'Dresden Airport', city: 'Dresden', country: 'DE', lat: 51.13, lon: 13.77, population: 0.6, tier: 'regional' },
  { code: 'EIN', name: 'Eindhoven Airport', city: 'Eindhoven', country: 'NL', lat: 51.45, lon: 5.37, population: 0.4, tier: 'regional' },
  { code: 'EMA', name: 'East Midlands Airport', city: 'Nottingham', country: 'GB', lat: 52.83, lon: -1.33, population: 1.0, tier: 'regional' },
  { code: 'FLR', name: 'Florence Airport', city: 'Florence', country: 'IT', lat: 43.81, lon: 11.2, population: 1.0, tier: 'regional' },
  { code: 'FUE', name: 'Fuerteventura Airport', city: 'Fuerteventura', country: 'ES', lat: 28.45, lon: -13.86, population: 0.11, tier: 'regional' },
  { code: 'GDN', name: 'Gdansk Lech Walesa Airport', city: 'Gdansk', country: 'PL', lat: 54.38, lon: 18.47, population: 0.8, tier: 'regional' },
  { code: 'GRO', name: 'Girona-Costa Brava Airport', city: 'Girona', country: 'ES', lat: 41.9, lon: 2.76, population: 0.1, tier: 'regional' },
  { code: 'GRZ', name: 'Graz Airport', city: 'Graz', country: 'AT', lat: 46.99, lon: 15.44, population: 0.3, tier: 'regional' },
  { code: 'GVA', name: 'Geneva Airport', city: 'Geneva', country: 'CH', lat: 46.24, lon: 6.11, population: 0.6, tier: 'major' },
  { code: 'INN', name: 'Innsbruck Airport', city: 'Innsbruck', country: 'AT', lat: 47.26, lon: 11.34, population: 0.2, tier: 'regional' },
  { code: 'JER', name: 'Jersey Airport', city: 'Saint Helier', country: 'JE', lat: 49.21, lon: -2.2, population: 0.1, tier: 'regional' },
  { code: 'KGS', name: 'Kos Island Intl', city: 'Kos', country: 'GR', lat: 36.79, lon: 27.09, population: 0.04, tier: 'regional' },
  { code: 'KRK', name: 'Krakow John Paul II Intl', city: 'Krakow', country: 'PL', lat: 50.08, lon: 19.78, population: 1.5, tier: 'regional' },
  { code: 'KRS', name: 'Kristiansand Airport', city: 'Kristiansand', country: 'NO', lat: 58.2, lon: 8.09, population: 0.1, tier: 'regional' },
  { code: 'KTW', name: 'Katowice Airport', city: 'Katowice', country: 'PL', lat: 50.47, lon: 19.08, population: 2.7, tier: 'regional' },
  { code: 'LCA', name: 'Larnaca Intl', city: 'Larnaca', country: 'CY', lat: 34.88, lon: 33.63, population: 0.4, tier: 'regional' },
  { code: 'LEJ', name: 'Leipzig/Halle Airport', city: 'Leipzig', country: 'DE', lat: 51.42, lon: 12.24, population: 0.6, tier: 'regional' },
  { code: 'LNZ', name: 'Linz Airport', city: 'Linz', country: 'AT', lat: 48.23, lon: 14.19, population: 0.2, tier: 'regional' },
  { code: 'LTN', name: 'London Luton Airport', city: 'London', country: 'GB', lat: 51.88, lon: -0.37, population: 9.3, tier: 'regional' },
  { code: 'LUX', name: 'Luxembourg Airport', city: 'Luxembourg', country: 'LU', lat: 49.63, lon: 6.21, population: 0.6, tier: 'regional' },
  { code: 'MAH', name: 'Menorca Airport', city: 'Mahon', country: 'ES', lat: 39.86, lon: 4.22, population: 0.09, tier: 'regional' },
  { code: 'MLA', name: 'Malta Intl', city: 'Valletta', country: 'MT', lat: 35.86, lon: 14.48, population: 0.5, tier: 'regional' },
  { code: 'MMX', name: 'Malmo Airport', city: 'Malmo', country: 'SE', lat: 55.54, lon: 13.37, population: 0.7, tier: 'regional' },
  { code: 'NYO', name: 'Stockholm Skavsta Airport', city: 'Stockholm', country: 'SE', lat: 58.79, lon: 16.91, population: 2.4, tier: 'regional' },
  { code: 'OLB', name: 'Olbia Costa Smeralda', city: 'Olbia', country: 'IT', lat: 40.9, lon: 9.52, population: 0.06, tier: 'regional' },
  { code: 'ORK', name: 'Cork Airport', city: 'Cork', country: 'IE', lat: 51.84, lon: -8.49, population: 0.3, tier: 'regional' },
  { code: 'SNN', name: 'Shannon Airport', city: 'Shannon', country: 'IE', lat: 52.7, lon: -8.92, population: 0.3, tier: 'regional' },
  { code: 'NOC', name: 'Ireland West Airport Knock', city: 'Knock', country: 'IE', lat: 53.91, lon: -8.82, population: 0.1, tier: 'regional' },
  { code: 'PFO', name: 'Paphos Intl', city: 'Paphos', country: 'CY', lat: 34.72, lon: 32.49, population: 0.4, tier: 'regional' },
  { code: 'POZ', name: 'Poznan-Lawica Airport', city: 'Poznan', country: 'PL', lat: 52.42, lon: 16.83, population: 0.7, tier: 'regional' },
  { code: 'PSR', name: 'Pescara Airport', city: 'Pescara', country: 'IT', lat: 42.43, lon: 14.18, population: 0.3, tier: 'regional' },
  { code: 'PUY', name: 'Pula Airport', city: 'Pula', country: 'HR', lat: 44.89, lon: 13.92, population: 0.06, tier: 'regional' },
  { code: 'RJK', name: 'Rijeka Airport', city: 'Rijeka', country: 'HR', lat: 45.22, lon: 14.57, population: 0.2, tier: 'regional' },
  { code: 'RTM', name: 'Rotterdam The Hague Airport', city: 'Rotterdam', country: 'NL', lat: 51.96, lon: 4.44, population: 1.0, tier: 'regional' },
  { code: 'RZE', name: 'Rzeszow-Jasionka Airport', city: 'Rzeszow', country: 'PL', lat: 50.11, lon: 22.02, population: 0.2, tier: 'regional' },
  { code: 'SDR', name: 'Santander Airport', city: 'Santander', country: 'ES', lat: 43.43, lon: -3.82, population: 0.2, tier: 'regional' },
  { code: 'SZG', name: 'Salzburg Airport', city: 'Salzburg', country: 'AT', lat: 47.8, lon: 13.0, population: 0.2, tier: 'regional' },
  { code: 'SZZ', name: 'Szczecin-Goleniow Airport', city: 'Szczecin', country: 'PL', lat: 53.58, lon: 14.9, population: 0.4, tier: 'regional' },
  { code: 'TGD', name: 'Podgorica Airport', city: 'Podgorica', country: 'ME', lat: 42.36, lon: 19.25, population: 0.3, tier: 'regional' },
  { code: 'TMP', name: 'Tampere-Pirkkala Airport', city: 'Tampere', country: 'FI', lat: 61.41, lon: 23.6, population: 0.4, tier: 'regional' },
  { code: 'TRS', name: 'Trieste Airport', city: 'Trieste', country: 'IT', lat: 45.83, lon: 13.47, population: 0.3, tier: 'regional' },
  { code: 'TSF', name: 'Venice Treviso Airport', city: 'Treviso', country: 'IT', lat: 45.65, lon: 12.19, population: 4.3, tier: 'regional' },
  { code: 'UME', name: 'Umea Airport', city: 'Umea', country: 'SE', lat: 63.79, lon: 20.28, population: 0.1, tier: 'regional' },
  { code: 'VGO', name: 'Vigo Airport', city: 'Vigo', country: 'ES', lat: 42.23, lon: -8.63, population: 0.3, tier: 'regional' },
  { code: 'VRN', name: 'Verona Villafranca Airport', city: 'Verona', country: 'IT', lat: 45.4, lon: 10.89, population: 0.5, tier: 'regional' },
  { code: 'WRO', name: 'Wroclaw Copernicus Airport', city: 'Wroclaw', country: 'PL', lat: 51.1, lon: 16.89, population: 0.9, tier: 'regional' },
  { code: 'KZN', name: 'Kazan Intl', city: 'Kazan', country: 'RU', lat: 55.61, lon: 49.28, population: 1.2, tier: 'regional' },
  { code: 'IKT', name: 'Irkutsk Intl', city: 'Irkutsk', country: 'RU', lat: 52.27, lon: 104.39, population: 0.6, tier: 'regional' },
  { code: 'KJA', name: 'Krasnoyarsk Intl', city: 'Krasnoyarsk', country: 'RU', lat: 56.17, lon: 92.49, population: 1.1, tier: 'regional' },
  { code: 'UFA', name: 'Ufa Intl', city: 'Ufa', country: 'RU', lat: 54.56, lon: 55.87, population: 1.1, tier: 'regional' },
  { code: 'ROV', name: 'Platov Intl', city: 'Rostov-on-Don', country: 'RU', lat: 47.49, lon: 39.92, population: 1.1, tier: 'regional' },
  { code: 'VOG', name: 'Volgograd Intl', city: 'Volgograd', country: 'RU', lat: 48.78, lon: 44.35, population: 1.0, tier: 'regional' },
  { code: 'OMS', name: 'Omsk Tsentralny', city: 'Omsk', country: 'RU', lat: 54.97, lon: 73.32, population: 1.2, tier: 'regional' },
  { code: 'BAX', name: 'Barnaul Airport', city: 'Barnaul', country: 'RU', lat: 53.36, lon: 83.54, population: 0.7, tier: 'regional' },
  { code: 'KEJ', name: 'Kemerovo Airport', city: 'Kemerovo', country: 'RU', lat: 55.27, lon: 86.11, population: 0.5, tier: 'regional' },
  { code: 'ABA', name: 'Abakan Intl', city: 'Abakan', country: 'RU', lat: 53.74, lon: 91.39, population: 0.2, tier: 'regional' },
  { code: 'MRV', name: 'Mineralnyye Vody Airport', city: 'Mineralnyye Vody', country: 'RU', lat: 44.22, lon: 43.08, population: 0.3, tier: 'regional' },
  { code: 'NBC', name: 'Begishevo Airport', city: 'Naberezhnye Chelny', country: 'RU', lat: 55.56, lon: 52.09, population: 0.5, tier: 'regional' },
  { code: 'TJM', name: 'Roshchino Intl', city: 'Tyumen', country: 'RU', lat: 57.19, lon: 68.56, population: 0.8, tier: 'regional' },
  { code: 'CLJ', name: 'Cluj-Napoca Intl', city: 'Cluj-Napoca', country: 'RO', lat: 46.79, lon: 23.69, population: 0.4, tier: 'regional' },
  { code: 'IAS', name: 'Iasi Intl', city: 'Iasi', country: 'RO', lat: 47.18, lon: 27.62, population: 0.4, tier: 'regional' },
  { code: 'TSR', name: 'Timisoara Traian Vuia', city: 'Timisoara', country: 'RO', lat: 45.8, lon: 21.34, population: 0.4, tier: 'regional' },
  { code: 'CND', name: 'Constanta Airport', city: 'Constanta', country: 'RO', lat: 44.36, lon: 28.49, population: 0.4, tier: 'regional' },
  { code: 'GZT', name: 'Gaziantep Oguzeli Intl', city: 'Gaziantep', country: 'TR', lat: 36.95, lon: 37.48, population: 2.1, tier: 'regional' },
  { code: 'TZX', name: 'Trabzon Airport', city: 'Trabzon', country: 'TR', lat: 40.99, lon: 39.79, population: 0.8, tier: 'regional' },
  { code: 'VAN', name: 'Van Ferit Melen Airport', city: 'Van', country: 'TR', lat: 38.47, lon: 43.33, population: 0.5, tier: 'regional' },
  { code: 'MLX', name: 'Malatya Erhac Airport', city: 'Malatya', country: 'TR', lat: 38.44, lon: 38.09, population: 0.5, tier: 'regional' },
  { code: 'KYA', name: 'Konya Airport', city: 'Konya', country: 'TR', lat: 37.98, lon: 32.56, population: 2.2, tier: 'regional' },
  { code: 'SZF', name: 'Samsun-Carsamba Airport', city: 'Samsun', country: 'TR', lat: 41.25, lon: 36.57, population: 0.6, tier: 'regional' },
  { code: 'ERZ', name: 'Erzurum Airport', city: 'Erzurum', country: 'TR', lat: 39.96, lon: 41.17, population: 0.4, tier: 'regional' },
  { code: 'GZP', name: 'Gazipasa-Alanya Airport', city: 'Alanya', country: 'TR', lat: 36.3, lon: 32.3, population: 0.1, tier: 'regional' },
  { code: 'KSY', name: 'Kars Airport', city: 'Kars', country: 'TR', lat: 40.56, lon: 43.12, population: 0.1, tier: 'regional' },
  { code: 'SJJ', name: 'Sarajevo Intl', city: 'Sarajevo', country: 'BA', lat: 43.82, lon: 18.33, population: 0.5, tier: 'regional' },
  { code: 'PRN', name: 'Pristina Adem Jashari', city: 'Pristina', country: 'XK', lat: 42.57, lon: 21.04, population: 0.2, tier: 'regional' },
  { code: 'KIV', name: 'Chisinau Intl', city: 'Chisinau', country: 'MD', lat: 46.93, lon: 28.93, population: 0.8, tier: 'regional' },
  { code: 'ODS', name: 'Odesa Intl', city: 'Odesa', country: 'UA', lat: 46.43, lon: 30.68, population: 1.0, tier: 'regional' },
  { code: 'HRK', name: 'Kharkiv Intl', city: 'Kharkiv', country: 'UA', lat: 49.92, lon: 36.29, population: 1.4, tier: 'regional' },
  { code: 'DNK', name: 'Dnipro Intl', city: 'Dnipro', country: 'UA', lat: 48.36, lon: 35.1, population: 1.0, tier: 'regional' },
  { code: 'HAJ', name: 'Hannover Airport', city: 'Hannover', country: 'DE', lat: 52.46, lon: 9.69, population: 0.5, tier: 'regional' },
  { code: 'SCN', name: 'Saarbrucken Airport', city: 'Saarbrucken', country: 'DE', lat: 49.21, lon: 7.11, population: 0.2, tier: 'regional' },
  { code: 'FKB', name: 'Karlsruhe Baden-Baden Airport', city: 'Karlsruhe', country: 'DE', lat: 48.78, lon: 8.08, population: 0.3, tier: 'regional' },
  { code: 'ERF', name: 'Erfurt-Weimar Airport', city: 'Erfurt', country: 'DE', lat: 50.98, lon: 10.96, population: 0.2, tier: 'regional' },
  { code: 'RLG', name: 'Rostock-Laage Airport', city: 'Rostock', country: 'DE', lat: 53.92, lon: 12.28, population: 0.2, tier: 'regional' },
  { code: 'BOH', name: 'Bournemouth Airport', city: 'Bournemouth', country: 'GB', lat: 50.78, lon: -1.83, population: 0.2, tier: 'regional' },
  { code: 'EXT', name: 'Exeter Airport', city: 'Exeter', country: 'GB', lat: 50.73, lon: -3.41, population: 0.3, tier: 'regional' },
  { code: 'INV', name: 'Inverness Airport', city: 'Inverness', country: 'GB', lat: 57.54, lon: -4.05, population: 0.05, tier: 'regional' },
  { code: 'SOU', name: 'Southampton Airport', city: 'Southampton', country: 'GB', lat: 50.95, lon: -1.36, population: 0.7, tier: 'regional' },
  { code: 'NQY', name: 'Newquay Airport', city: 'Newquay', country: 'GB', lat: 50.44, lon: -5.0, population: 0.06, tier: 'regional' },
  { code: 'ALY', name: 'El Nouzha Airport', city: 'Alexandria', country: 'EG', lat: 31.18, lon: 29.95, population: 5.2, tier: 'regional' },
  { code: 'ASM', name: 'Asmara Intl', city: 'Asmara', country: 'ER', lat: 15.29, lon: 38.91, population: 0.9, tier: 'regional' },
  { code: 'BGF', name: "Bangui M'Poko Intl", city: 'Bangui', country: 'CF', lat: 4.4, lon: 18.52, population: 0.8, tier: 'regional' },
  { code: 'BJL', name: 'Banjul Intl', city: 'Banjul', country: 'GM', lat: 13.34, lon: -16.65, population: 0.5, tier: 'regional' },
  { code: 'CBQ', name: 'Margaret Ekpo Intl', city: 'Calabar', country: 'NG', lat: 4.98, lon: 8.35, population: 0.5, tier: 'regional' },
  { code: 'DJE', name: 'Djerba-Zarzis Intl', city: 'Djerba', country: 'TN', lat: 33.87, lon: 10.78, population: 0.1, tier: 'regional' },
  { code: 'DSS', name: 'Blaise Diagne Intl', city: 'Dakar', country: 'SN', lat: 14.67, lon: -17.07, population: 3.8, tier: 'regional' },
  { code: 'ENU', name: 'Akanu Ibiam Intl', city: 'Enugu', country: 'NG', lat: 6.47, lon: 7.56, population: 0.7, tier: 'regional' },
  { code: 'HGA', name: 'Egal Intl', city: 'Hargeisa', country: 'SO', lat: 9.52, lon: 44.09, population: 1.5, tier: 'regional' },
  { code: 'JIB', name: 'Djibouti-Ambouli Intl', city: 'Djibouti', country: 'DJ', lat: 11.55, lon: 43.16, population: 1.1, tier: 'regional' },
  { code: 'JOS', name: 'Yakubu Gowon Airport', city: 'Jos', country: 'NG', lat: 9.64, lon: 8.87, population: 0.9, tier: 'regional' },
  { code: 'KAN', name: 'Mallam Aminu Kano Intl', city: 'Kano', country: 'NG', lat: 12.05, lon: 8.52, population: 4.0, tier: 'regional' },
  { code: 'KIS', name: 'Kisumu Intl', city: 'Kisumu', country: 'KE', lat: -0.09, lon: 34.73, population: 0.5, tier: 'regional' },
  { code: 'LAD', name: 'Quatro de Fevereiro', city: 'Luanda', country: 'AO', lat: -8.86, lon: 13.23, population: 7.5, tier: 'major' },
  { code: 'MBA', name: 'Mombasa Moi Intl', city: 'Mombasa', country: 'KE', lat: -4.03, lon: 39.59, population: 1.2, tier: 'regional' },
  { code: 'MWZ', name: 'Mwanza Airport', city: 'Mwanza', country: 'TZ', lat: -2.44, lon: 32.93, population: 0.9, tier: 'regional' },
  { code: 'NBE', name: 'Enfidha-Hammamet Intl', city: 'Enfidha', country: 'TN', lat: 36.08, lon: 10.44, population: 0.2, tier: 'regional' },
  { code: 'NKC', name: 'Nouakchott Oumtounsy Intl', city: 'Nouakchott', country: 'MR', lat: 18.1, lon: -15.95, population: 1.2, tier: 'regional' },
  { code: 'ORN', name: 'Oran Ahmed Ben Bella Intl', city: 'Oran', country: 'DZ', lat: 35.62, lon: -0.62, population: 1.8, tier: 'regional' },
  { code: 'OXB', name: 'Osvaldo Vieira Intl', city: 'Bissau', country: 'GW', lat: 11.89, lon: -15.65, population: 0.5, tier: 'regional' },
  { code: 'PNR', name: 'Pointe-Noire Airport', city: 'Pointe-Noire', country: 'CG', lat: -4.82, lon: 11.89, population: 1.0, tier: 'regional' },
  { code: 'RBA', name: 'Rabat-Sale Airport', city: 'Rabat', country: 'MA', lat: 34.05, lon: -6.75, population: 1.9, tier: 'regional' },
  { code: 'RUN', name: 'Roland Garros Airport', city: 'Saint-Denis Reunion', country: 'RE', lat: -20.89, lon: 55.51, population: 0.3, tier: 'regional' },
  { code: 'SEZ', name: 'Seychelles Intl', city: 'Victoria Seychelles', country: 'SC', lat: -4.67, lon: 55.52, population: 0.1, tier: 'regional' },
  { code: 'SID', name: 'Amilcar Cabral Intl', city: 'Sal Island', country: 'CV', lat: 16.74, lon: -22.95, population: 0.05, tier: 'regional' },
  { code: 'TMS', name: 'Sao Tome Intl', city: 'Sao Tome', country: 'ST', lat: 0.38, lon: 6.71, population: 0.07, tier: 'regional' },
  { code: 'TNG', name: 'Ibn Battuta Airport', city: 'Tangier', country: 'MA', lat: 35.73, lon: -5.92, population: 1.0, tier: 'regional' },
  { code: 'ZNZ', name: 'Abeid Amani Karume Intl', city: 'Zanzibar', country: 'TZ', lat: -6.22, lon: 39.22, population: 0.4, tier: 'regional' },
  { code: 'CZL', name: 'Mohamed Boudiaf Intl', city: 'Constantine', country: 'DZ', lat: 36.28, lon: 6.62, population: 1.0, tier: 'regional' },
  { code: 'MJI', name: 'Mitiga Airport', city: 'Tripoli', country: 'LY', lat: 32.89, lon: 13.28, population: 3.5, tier: 'regional' },
  { code: 'SFX', name: 'Sfax Thyna Intl', city: 'Sfax', country: 'TN', lat: 34.72, lon: 10.69, population: 0.3, tier: 'regional' },
  { code: 'PHG', name: 'Port Harcourt Intl', city: 'Port Harcourt', country: 'NG', lat: 4.01, lon: 7.2, population: 1.9, tier: 'regional' },
  { code: 'ILR', name: 'Ilorin Intl', city: 'Ilorin', country: 'NG', lat: 8.44, lon: 4.49, population: 0.8, tier: 'regional' },
  { code: 'MIU', name: 'Maiduguri Intl', city: 'Maiduguri', country: 'NG', lat: 11.85, lon: 13.08, population: 0.8, tier: 'regional' },
  { code: 'SKO', name: 'Sadiq Abubakar III Intl', city: 'Sokoto', country: 'NG', lat: 12.92, lon: 5.21, population: 0.8, tier: 'regional' },
  { code: 'MYD', name: 'Malindi Airport', city: 'Malindi', country: 'KE', lat: -3.23, lon: 40.1, population: 0.2, tier: 'regional' },
  { code: 'MUB', name: 'Maun Airport', city: 'Maun', country: 'BW', lat: -19.97, lon: 23.43, population: 0.07, tier: 'regional' },
  { code: 'ADE', name: 'Aden Intl', city: 'Aden', country: 'YE', lat: 12.83, lon: 45.03, population: 1.0, tier: 'regional' },
  { code: 'AQJ', name: 'King Hussein Intl', city: 'Aqaba', country: 'JO', lat: 29.61, lon: 35.02, population: 0.2, tier: 'regional' },
  { code: 'EBL', name: 'Erbil Intl', city: 'Erbil', country: 'IQ', lat: 36.23, lon: 44.0, population: 1.5, tier: 'regional' },
  { code: 'NJF', name: 'Al Najaf Intl', city: 'Najaf', country: 'IQ', lat: 31.99, lon: 44.4, population: 2.0, tier: 'regional' },
  { code: 'OSM', name: 'Mosul Airport', city: 'Mosul', country: 'IQ', lat: 36.31, lon: 43.15, population: 1.8, tier: 'regional' },
  { code: 'BSR', name: 'Basra Intl', city: 'Basra', country: 'IQ', lat: 30.55, lon: 47.66, population: 3.0, tier: 'regional' },
  { code: 'SAH', name: 'Sanaa Intl', city: 'Sanaa', country: 'YE', lat: 15.48, lon: 44.22, population: 3.9, tier: 'regional' },
  { code: 'TIF', name: 'Taif Regional Airport', city: 'Taif', country: 'SA', lat: 21.48, lon: 40.54, population: 1.1, tier: 'regional' },
  { code: 'GIZ', name: 'Jizan Regional Airport', city: 'Jizan', country: 'SA', lat: 16.9, lon: 42.58, population: 0.5, tier: 'regional' },
  { code: 'HOF', name: 'Al-Ahsa Intl', city: 'Al-Ahsa', country: 'SA', lat: 25.29, lon: 49.48, population: 1.1, tier: 'regional' },
  { code: 'ELQ', name: 'Prince Nayef bin Abdulaziz', city: 'Qassim', country: 'SA', lat: 26.3, lon: 43.77, population: 1.3, tier: 'regional' },
  { code: 'TUU', name: 'Tabuk Regional Airport', city: 'Tabuk', country: 'SA', lat: 28.37, lon: 36.62, population: 0.8, tier: 'regional' },
  { code: 'AHB', name: 'Abha Regional Airport', city: 'Abha', country: 'SA', lat: 18.24, lon: 42.66, population: 1.1, tier: 'regional' },
  { code: 'HAS', name: 'Hail Regional Airport', city: 'Hail', country: 'SA', lat: 27.44, lon: 41.69, population: 0.7, tier: 'regional' },
  { code: 'YNB', name: 'Prince Abdulmohsen Intl', city: 'Yanbu', country: 'SA', lat: 24.14, lon: 38.06, population: 0.2, tier: 'regional' },
  { code: 'SLL', name: 'Salalah Airport', city: 'Salalah', country: 'OM', lat: 17.04, lon: 54.09, population: 0.3, tier: 'regional' },
  { code: 'KHS', name: 'Khasab Airport', city: 'Khasab', country: 'OM', lat: 26.17, lon: 56.24, population: 0.02, tier: 'regional' },
  { code: 'ATQ', name: 'Sri Guru Ram Dass Jee Intl', city: 'Amritsar', country: 'IN', lat: 31.71, lon: 74.8, population: 1.1, tier: 'regional' },
  { code: 'BBI', name: 'Biju Patnaik Intl', city: 'Bhubaneswar', country: 'IN', lat: 20.24, lon: 85.82, population: 1.0, tier: 'regional' },
  { code: 'BHO', name: 'Raja Bhoj Airport', city: 'Bhopal', country: 'IN', lat: 23.29, lon: 77.34, population: 1.9, tier: 'regional' },
  { code: 'CJB', name: 'Coimbatore Intl', city: 'Coimbatore', country: 'IN', lat: 11.03, lon: 77.04, population: 2.2, tier: 'regional' },
  { code: 'GAU', name: 'Lokpriya Gopinath Bordoloi', city: 'Guwahati', country: 'IN', lat: 26.11, lon: 91.59, population: 1.1, tier: 'regional' },
  { code: 'IXB', name: 'Bagdogra Airport', city: 'Siliguri', country: 'IN', lat: 26.68, lon: 88.33, population: 1.3, tier: 'regional' },
  { code: 'IXC', name: 'Chandigarh Intl', city: 'Chandigarh', country: 'IN', lat: 30.67, lon: 76.79, population: 1.0, tier: 'regional' },
  { code: 'IXJ', name: 'Jammu Airport', city: 'Jammu', country: 'IN', lat: 32.69, lon: 74.84, population: 0.7, tier: 'regional' },
  { code: 'IXL', name: 'Kushok Bakula Rimpochee', city: 'Leh', country: 'IN', lat: 34.14, lon: 77.55, population: 0.3, tier: 'regional' },
  { code: 'IXR', name: 'Birsa Munda Airport', city: 'Ranchi', country: 'IN', lat: 23.31, lon: 85.32, population: 1.5, tier: 'regional' },
  { code: 'NAG', name: 'Dr. Babasaheb Ambedkar Intl', city: 'Nagpur', country: 'IN', lat: 21.09, lon: 79.05, population: 2.5, tier: 'regional' },
  { code: 'PAT', name: 'Lok Nayak Jayaprakash', city: 'Patna', country: 'IN', lat: 25.59, lon: 85.09, population: 2.5, tier: 'regional' },
  { code: 'RAJ', name: 'Rajkot Intl', city: 'Rajkot', country: 'IN', lat: 22.31, lon: 70.78, population: 1.5, tier: 'regional' },
  { code: 'STV', name: 'Surat Airport', city: 'Surat', country: 'IN', lat: 21.11, lon: 72.74, population: 7.2, tier: 'regional' },
  { code: 'TRV', name: 'Trivandrum Intl', city: 'Thiruvananthapuram', country: 'IN', lat: 8.48, lon: 76.92, population: 2.1, tier: 'regional' },
  { code: 'VGA', name: 'Vijayawada Airport', city: 'Vijayawada', country: 'IN', lat: 16.53, lon: 80.8, population: 1.5, tier: 'regional' },
  { code: 'VTZ', name: 'Visakhapatnam Intl', city: 'Visakhapatnam', country: 'IN', lat: 17.72, lon: 83.22, population: 2.0, tier: 'regional' },
  { code: 'IXM', name: 'Madurai Airport', city: 'Madurai', country: 'IN', lat: 9.83, lon: 78.09, population: 1.5, tier: 'regional' },
  { code: 'TRZ', name: 'Tiruchirappalli Intl', city: 'Tiruchirappalli', country: 'IN', lat: 10.77, lon: 78.71, population: 1.0, tier: 'regional' },
  { code: 'CCJ', name: 'Calicut Intl', city: 'Kozhikode', country: 'IN', lat: 11.14, lon: 75.95, population: 2.1, tier: 'regional' },
  { code: 'IDR', name: 'Devi Ahilyabai Holkar', city: 'Indore', country: 'IN', lat: 22.72, lon: 75.8, population: 2.2, tier: 'regional' },
  { code: 'VNS', name: 'Lal Bahadur Shastri Intl', city: 'Varanasi', country: 'IN', lat: 25.45, lon: 82.86, population: 1.4, tier: 'regional' },
  { code: 'RPR', name: 'Swami Vivekananda Airport', city: 'Raipur', country: 'IN', lat: 21.18, lon: 81.74, population: 1.3, tier: 'regional' },
  { code: 'BDQ', name: 'Vadodara Airport', city: 'Vadodara', country: 'IN', lat: 22.34, lon: 73.23, population: 2.1, tier: 'regional' },
  { code: 'IXZ', name: 'Veer Savarkar Intl', city: 'Port Blair', country: 'IN', lat: 11.64, lon: 92.73, population: 0.4, tier: 'regional' },
  { code: 'AGR', name: 'Agra Airport', city: 'Agra', country: 'IN', lat: 27.16, lon: 77.96, population: 1.7, tier: 'regional' },
  { code: 'DIB', name: 'Dibrugarh Airport', city: 'Dibrugarh', country: 'IN', lat: 27.48, lon: 95.02, population: 0.5, tier: 'regional' },
  { code: 'JRH', name: 'Jorhat Airport', city: 'Jorhat', country: 'IN', lat: 26.73, lon: 94.18, population: 0.4, tier: 'regional' },
  { code: 'SKT', name: 'Sialkot Intl', city: 'Sialkot', country: 'PK', lat: 32.54, lon: 74.36, population: 0.7, tier: 'regional' },
  { code: 'CGO', name: 'Zhengzhou Xinzheng Intl', city: 'Zhengzhou', country: 'CN', lat: 34.52, lon: 113.84, population: 10.5, tier: 'major' },
  { code: 'FOC', name: 'Fuzhou Changle Intl', city: 'Fuzhou', country: 'CN', lat: 25.93, lon: 119.66, population: 8.1, tier: 'major' },
  { code: 'HFE', name: 'Hefei Xinqiao Intl', city: 'Hefei', country: 'CN', lat: 31.33, lon: 116.98, population: 8.4, tier: 'major' },
  { code: 'KHN', name: 'Nanchang Changbei Intl', city: 'Nanchang', country: 'CN', lat: 28.86, lon: 115.9, population: 6.0, tier: 'regional' },
  { code: 'KWE', name: 'Guiyang Longdongbao Intl', city: 'Guiyang', country: 'CN', lat: 26.54, lon: 106.8, population: 5.0, tier: 'regional' },
  { code: 'LHW', name: 'Lanzhou Zhongchuan Intl', city: 'Lanzhou', country: 'CN', lat: 36.52, lon: 103.62, population: 4.0, tier: 'regional' },
  { code: 'LJG', name: 'Lijiang Sanyi Intl', city: 'Lijiang', country: 'CN', lat: 26.68, lon: 100.25, population: 1.3, tier: 'regional' },
  { code: 'LXA', name: 'Lhasa Gonggar Airport', city: 'Lhasa', country: 'CN', lat: 29.3, lon: 90.91, population: 0.8, tier: 'regional' },
  { code: 'NGB', name: 'Ningbo Lishe Intl', city: 'Ningbo', country: 'CN', lat: 29.83, lon: 121.46, population: 8.2, tier: 'major' },
  { code: 'SJW', name: 'Shijiazhuang Zhengding', city: 'Shijiazhuang', country: 'CN', lat: 38.28, lon: 114.7, population: 11.0, tier: 'major' },
  { code: 'SYX', name: 'Sanya Phoenix Intl', city: 'Sanya', country: 'CN', lat: 18.3, lon: 109.41, population: 0.7, tier: 'regional' },
  { code: 'TSN', name: 'Tianjin Binhai Intl', city: 'Tianjin', country: 'CN', lat: 39.12, lon: 117.35, population: 13.6, tier: 'major' },
  { code: 'TYN', name: 'Taiyuan Wusu Intl', city: 'Taiyuan', country: 'CN', lat: 37.75, lon: 112.63, population: 5.3, tier: 'regional' },
  { code: 'WNZ', name: 'Wenzhou Longwan Intl', city: 'Wenzhou', country: 'CN', lat: 27.91, lon: 120.85, population: 9.3, tier: 'major' },
  { code: 'XNN', name: 'Xining Caojiabao Intl', city: 'Xining', country: 'CN', lat: 36.53, lon: 102.04, population: 2.4, tier: 'regional' },
  { code: 'YNT', name: 'Yantai Penglai Intl', city: 'Yantai', country: 'CN', lat: 37.66, lon: 120.99, population: 7.1, tier: 'regional' },
  { code: 'ZUH', name: 'Zhuhai Jinwan Airport', city: 'Zhuhai', country: 'CN', lat: 22.0, lon: 113.38, population: 2.5, tier: 'regional' },
  { code: 'SZX', name: 'Shenzhen Baoan Intl', city: 'Shenzhen', country: 'CN', lat: 22.64, lon: 113.81, population: 17.5, tier: 'mega' },
  { code: 'MIG', name: 'Mianyang Nanjiao Airport', city: 'Mianyang', country: 'CN', lat: 31.43, lon: 104.74, population: 5.0, tier: 'regional' },
  { code: 'INC', name: 'Yinchuan Hedong Intl', city: 'Yinchuan', country: 'CN', lat: 38.32, lon: 106.39, population: 2.9, tier: 'regional' },
  { code: 'BAV', name: 'Baotou Airport', city: 'Baotou', country: 'CN', lat: 40.56, lon: 109.99, population: 2.7, tier: 'regional' },
  { code: 'YIW', name: 'Yiwu Airport', city: 'Yiwu', country: 'CN', lat: 29.34, lon: 120.03, population: 1.8, tier: 'regional' },
  { code: 'KHG', name: 'Kashgar Airport', city: 'Kashgar', country: 'CN', lat: 39.54, lon: 76.02, population: 0.7, tier: 'regional' },
  { code: 'LYA', name: 'Luoyang Beijiao Airport', city: 'Luoyang', country: 'CN', lat: 34.74, lon: 112.39, population: 7.0, tier: 'regional' },
  { code: 'ZYI', name: 'Zunyi Xinzhou Airport', city: 'Zunyi', country: 'CN', lat: 27.59, lon: 107.01, population: 6.8, tier: 'regional' },
  { code: 'WDS', name: 'Shiyan Wudangshan Airport', city: 'Shiyan', country: 'CN', lat: 32.59, lon: 110.91, population: 3.4, tier: 'regional' },
  { code: 'ENH', name: 'Enshi Xujiaping Airport', city: 'Enshi', country: 'CN', lat: 30.32, lon: 109.49, population: 3.8, tier: 'regional' },
  { code: 'JGN', name: 'Jiayuguan Airport', city: 'Jiayuguan', country: 'CN', lat: 39.86, lon: 98.34, population: 0.3, tier: 'regional' },
  { code: 'HIJ', name: 'Hiroshima Airport', city: 'Hiroshima', country: 'JP', lat: 34.44, lon: 132.92, population: 2.9, tier: 'regional' },
  { code: 'KMI', name: 'Miyazaki Airport', city: 'Miyazaki', country: 'JP', lat: 31.88, lon: 131.45, population: 0.4, tier: 'regional' },
  { code: 'KMJ', name: 'Kumamoto Airport', city: 'Kumamoto', country: 'JP', lat: 32.84, lon: 130.86, population: 0.7, tier: 'regional' },
  { code: 'KOJ', name: 'Kagoshima Airport', city: 'Kagoshima', country: 'JP', lat: 31.8, lon: 130.72, population: 0.6, tier: 'regional' },
  { code: 'NGS', name: 'Nagasaki Airport', city: 'Nagasaki', country: 'JP', lat: 32.92, lon: 129.92, population: 0.4, tier: 'regional' },
  { code: 'OIT', name: 'Oita Airport', city: 'Oita', country: 'JP', lat: 33.48, lon: 131.74, population: 0.5, tier: 'regional' },
  { code: 'TOY', name: 'Toyama Airport', city: 'Toyama', country: 'JP', lat: 36.65, lon: 137.19, population: 0.4, tier: 'regional' },
  { code: 'TAK', name: 'Takamatsu Airport', city: 'Takamatsu', country: 'JP', lat: 34.21, lon: 134.02, population: 0.4, tier: 'regional' },
  { code: 'KCZ', name: 'Kochi Ryoma Airport', city: 'Kochi', country: 'JP', lat: 33.55, lon: 133.67, population: 0.3, tier: 'regional' },
  { code: 'MYJ', name: 'Matsuyama Airport', city: 'Matsuyama', country: 'JP', lat: 33.83, lon: 132.7, population: 0.5, tier: 'regional' },
  { code: 'AOJ', name: 'Aomori Airport', city: 'Aomori', country: 'JP', lat: 40.73, lon: 140.69, population: 0.3, tier: 'regional' },
  { code: 'AXT', name: 'Akita Airport', city: 'Akita', country: 'JP', lat: 39.62, lon: 140.22, population: 0.3, tier: 'regional' },
  { code: 'GAJ', name: 'Yamagata Airport', city: 'Yamagata', country: 'JP', lat: 38.41, lon: 140.37, population: 0.3, tier: 'regional' },
  { code: 'FSZ', name: 'Shizuoka Airport', city: 'Shizuoka', country: 'JP', lat: 34.8, lon: 138.19, population: 0.7, tier: 'regional' },
  { code: 'KKJ', name: 'Kitakyushu Airport', city: 'Kitakyushu', country: 'JP', lat: 33.85, lon: 131.04, population: 1.0, tier: 'regional' },
  { code: 'TTJ', name: 'Tottori Airport', city: 'Tottori', country: 'JP', lat: 35.53, lon: 134.17, population: 0.2, tier: 'regional' },
  { code: 'MMY', name: 'Miyako Airport', city: 'Miyako', country: 'JP', lat: 24.78, lon: 125.3, population: 0.06, tier: 'regional' },
  { code: 'ISG', name: 'Ishigaki Airport', city: 'Ishigaki', country: 'JP', lat: 24.34, lon: 124.19, population: 0.05, tier: 'regional' },
  { code: 'ASJ', name: 'Amami Airport', city: 'Amami', country: 'JP', lat: 28.43, lon: 129.71, population: 0.07, tier: 'regional' },
  { code: 'CJJ', name: 'Cheongju Airport', city: 'Cheongju', country: 'KR', lat: 36.72, lon: 127.5, population: 0.8, tier: 'regional' },
  { code: 'KWJ', name: 'Gwangju Airport', city: 'Gwangju', country: 'KR', lat: 35.13, lon: 126.81, population: 1.5, tier: 'regional' },
  { code: 'RSU', name: 'Yeosu Airport', city: 'Yeosu', country: 'KR', lat: 34.84, lon: 127.62, population: 0.3, tier: 'regional' },
  { code: 'USN', name: 'Ulsan Airport', city: 'Ulsan', country: 'KR', lat: 35.59, lon: 129.35, population: 1.2, tier: 'regional' },
  { code: 'MWX', name: 'Muan Intl', city: 'Muan', country: 'KR', lat: 34.99, lon: 126.38, population: 0.8, tier: 'regional' },
  { code: 'BDJ', name: 'Syamsudin Noor Intl', city: 'Banjarmasin', country: 'ID', lat: -3.44, lon: 114.76, population: 0.7, tier: 'regional' },
  { code: 'BTH', name: 'Hang Nadim Airport', city: 'Batam', country: 'ID', lat: 1.12, lon: 104.12, population: 1.2, tier: 'regional' },
  { code: 'LOP', name: 'Lombok Intl', city: 'Praya', country: 'ID', lat: -8.76, lon: 116.28, population: 1.1, tier: 'regional' },
  { code: 'MDC', name: 'Sam Ratulangi Intl', city: 'Manado', country: 'ID', lat: 1.55, lon: 124.93, population: 0.6, tier: 'regional' },
  { code: 'PDG', name: 'Minangkabau Intl', city: 'Padang', country: 'ID', lat: -0.79, lon: 100.28, population: 1.0, tier: 'regional' },
  { code: 'PLM', name: 'Sultan Mahmud Badaruddin II', city: 'Palembang', country: 'ID', lat: -2.9, lon: 104.7, population: 1.9, tier: 'regional' },
  { code: 'PKU', name: 'Sultan Syarif Kasim II', city: 'Pekanbaru', country: 'ID', lat: 0.46, lon: 101.44, population: 1.0, tier: 'regional' },
  { code: 'SRG', name: 'Ahmad Yani Intl', city: 'Semarang', country: 'ID', lat: -6.97, lon: 110.37, population: 1.8, tier: 'regional' },
  { code: 'TKG', name: 'Radin Inten II Intl', city: 'Bandar Lampung', country: 'ID', lat: -5.24, lon: 105.18, population: 1.0, tier: 'regional' },
  { code: 'CRK', name: 'Clark Intl', city: 'Angeles City', country: 'PH', lat: 15.19, lon: 120.56, population: 0.5, tier: 'regional' },
  { code: 'KLO', name: 'Kalibo Intl', city: 'Kalibo', country: 'PH', lat: 11.68, lon: 122.38, population: 0.1, tier: 'regional' },
  { code: 'PPS', name: 'Puerto Princesa Intl', city: 'Puerto Princesa', country: 'PH', lat: 9.74, lon: 118.76, population: 0.3, tier: 'regional' },
  { code: 'TAG', name: 'Tagbilaran Airport', city: 'Tagbilaran', country: 'PH', lat: 9.66, lon: 123.85, population: 0.2, tier: 'regional' },
  { code: 'ZAM', name: 'Zamboanga Intl', city: 'Zamboanga', country: 'PH', lat: 6.92, lon: 122.06, population: 0.9, tier: 'regional' },
  { code: 'HPH', name: 'Cat Bi Intl', city: 'Haiphong', country: 'VN', lat: 20.82, lon: 106.72, population: 2.3, tier: 'regional' },
  { code: 'HUI', name: 'Phu Bai Intl', city: 'Hue', country: 'VN', lat: 16.4, lon: 107.7, population: 0.4, tier: 'regional' },
  { code: 'PQC', name: 'Phu Quoc Intl', city: 'Phu Quoc', country: 'VN', lat: 10.23, lon: 103.97, population: 0.2, tier: 'regional' },
  { code: 'UIH', name: 'Phu Cat Airport', city: 'Quy Nhon', country: 'VN', lat: 13.95, lon: 109.04, population: 0.5, tier: 'regional' },
  { code: 'VCA', name: 'Can Tho Intl', city: 'Can Tho', country: 'VN', lat: 10.08, lon: 105.71, population: 1.4, tier: 'regional' },
  { code: 'BMV', name: 'Buon Ma Thuot Airport', city: 'Buon Ma Thuot', country: 'VN', lat: 12.67, lon: 108.12, population: 0.6, tier: 'regional' },
  { code: 'HDY', name: 'Hat Yai Intl', city: 'Hat Yai', country: 'TH', lat: 6.93, lon: 100.39, population: 1.5, tier: 'regional' },
  { code: 'NST', name: 'Nakhon Si Thammarat Airport', city: 'Nakhon Si Thammarat', country: 'TH', lat: 8.54, lon: 100.08, population: 0.5, tier: 'regional' },
  { code: 'UBP', name: 'Ubon Ratchathani Airport', city: 'Ubon Ratchathani', country: 'TH', lat: 15.25, lon: 104.87, population: 0.4, tier: 'regional' },
  { code: 'UTP', name: 'U-Tapao Intl', city: 'Pattaya', country: 'TH', lat: 12.68, lon: 101.0, population: 0.5, tier: 'regional' },
  { code: 'MDL', name: 'Mandalay Intl', city: 'Mandalay', country: 'MM', lat: 21.7, lon: 95.98, population: 1.5, tier: 'regional' },
  { code: 'NYT', name: 'Naypyidaw Intl', city: 'Naypyidaw', country: 'MM', lat: 19.62, lon: 96.2, population: 1.2, tier: 'regional' },
  { code: 'IPH', name: 'Sultan Azlan Shah Airport', city: 'Ipoh', country: 'MY', lat: 4.57, lon: 101.09, population: 0.8, tier: 'regional' },
  { code: 'KBR', name: 'Sultan Ismail Petra Airport', city: 'Kota Bharu', country: 'MY', lat: 6.17, lon: 102.29, population: 0.6, tier: 'regional' },
  { code: 'KUA', name: 'Kuantan Airport', city: 'Kuantan', country: 'MY', lat: 3.78, lon: 103.21, population: 0.4, tier: 'regional' },
  { code: 'MYY', name: 'Miri Airport', city: 'Miri', country: 'MY', lat: 4.32, lon: 113.99, population: 0.3, tier: 'regional' },
  { code: 'SDK', name: 'Sandakan Airport', city: 'Sandakan', country: 'MY', lat: 5.9, lon: 118.06, population: 0.4, tier: 'regional' },
  { code: 'TGG', name: 'Sultan Mahmud Intl', city: 'Kuala Terengganu', country: 'MY', lat: 5.38, lon: 103.1, population: 0.4, tier: 'regional' },
  { code: 'TWU', name: 'Tawau Airport', city: 'Tawau', country: 'MY', lat: 4.32, lon: 118.13, population: 0.2, tier: 'regional' },
  { code: 'CIT', name: 'Shymkent Intl', city: 'Shymkent', country: 'KZ', lat: 42.36, lon: 69.48, population: 1.1, tier: 'regional' },
  { code: 'GUW', name: 'Atyrau Airport', city: 'Atyrau', country: 'KZ', lat: 47.12, lon: 51.82, population: 0.3, tier: 'regional' },
  { code: 'SCO', name: 'Aktau Airport', city: 'Aktau', country: 'KZ', lat: 43.86, lon: 51.09, population: 0.2, tier: 'regional' },
  { code: 'KSN', name: 'Kostanay Airport', city: 'Kostanay', country: 'KZ', lat: 53.21, lon: 63.55, population: 0.5, tier: 'regional' },
  { code: 'PLX', name: 'Semey Airport', city: 'Semey', country: 'KZ', lat: 50.35, lon: 80.23, population: 0.3, tier: 'regional' },
  { code: 'UKK', name: 'Ust-Kamenogorsk Airport', city: 'Ust-Kamenogorsk', country: 'KZ', lat: 50.04, lon: 82.49, population: 0.3, tier: 'regional' },
  { code: 'OSS', name: 'Osh Airport', city: 'Osh', country: 'KG', lat: 40.61, lon: 72.79, population: 0.3, tier: 'regional' },
  { code: 'TSV', name: 'Townsville Airport', city: 'Townsville', country: 'AU', lat: -19.25, lon: 146.77, population: 0.2, tier: 'regional' },
  { code: 'MKY', name: 'Mackay Airport', city: 'Mackay', country: 'AU', lat: -21.17, lon: 149.18, population: 0.1, tier: 'regional' },
  { code: 'ROK', name: 'Rockhampton Airport', city: 'Rockhampton', country: 'AU', lat: -23.38, lon: 150.47, population: 0.1, tier: 'regional' },
  { code: 'HTI', name: 'Hamilton Island Airport', city: 'Hamilton Island', country: 'AU', lat: -20.36, lon: 148.95, population: 0.01, tier: 'regional' },
  { code: 'MCY', name: 'Sunshine Coast Airport', city: 'Sunshine Coast', country: 'AU', lat: -26.6, lon: 153.09, population: 0.5, tier: 'regional' },
  { code: 'LST', name: 'Launceston Airport', city: 'Launceston', country: 'AU', lat: -41.54, lon: 147.21, population: 0.1, tier: 'regional' },
  { code: 'PHE', name: 'Port Hedland Intl', city: 'Port Hedland', country: 'AU', lat: -20.38, lon: 118.63, population: 0.01, tier: 'regional' },
  { code: 'KTA', name: 'Karratha Airport', city: 'Karratha', country: 'AU', lat: -20.71, lon: 116.77, population: 0.03, tier: 'regional' },
  { code: 'APW', name: 'Faleolo Intl', city: 'Apia', country: 'WS', lat: -13.83, lon: -172.01, population: 0.2, tier: 'regional' },
  { code: 'TBU', name: 'Fuaamotu Intl', city: 'Nukualofa', country: 'TO', lat: -21.24, lon: -175.15, population: 0.1, tier: 'regional' },
  { code: 'TRW', name: 'Bonriki Intl', city: 'Tarawa', country: 'KI', lat: 1.38, lon: 173.15, population: 0.06, tier: 'regional' },
  { code: 'ABE', name: 'Lehigh Valley Intl', city: 'Allentown', country: 'US', lat: 40.65, lon: -75.44, population: 0.8, tier: 'regional' },
  { code: 'ACT', name: 'Waco Regional Airport', city: 'Waco', country: 'US', lat: 31.61, lon: -97.23, population: 0.3, tier: 'regional' },
  { code: 'AGS', name: 'Augusta Regional Airport', city: 'Augusta', country: 'US', lat: 33.37, lon: -81.96, population: 0.6, tier: 'regional' },
  { code: 'FSM', name: 'Fort Smith Regional', city: 'Fort Smith', country: 'US', lat: 35.34, lon: -94.37, population: 0.3, tier: 'regional' },
  { code: 'GGG', name: 'East Texas Regional', city: 'Longview TX', country: 'US', lat: 32.38, lon: -94.71, population: 0.2, tier: 'regional' },
  { code: 'GNV', name: 'Gainesville Regional', city: 'Gainesville FL', country: 'US', lat: 29.69, lon: -82.27, population: 0.3, tier: 'regional' },
  { code: 'HLN', name: 'Helena Regional Airport', city: 'Helena', country: 'US', lat: 46.61, lon: -111.98, population: 0.08, tier: 'regional' },
  { code: 'JLN', name: 'Joplin Regional Airport', city: 'Joplin', country: 'US', lat: 37.15, lon: -94.5, population: 0.2, tier: 'regional' },
  { code: 'LBF', name: 'North Platte Regional', city: 'North Platte NE', country: 'US', lat: 41.13, lon: -100.68, population: 0.03, tier: 'regional' },
  { code: 'MFE', name: 'McAllen Miller Intl', city: 'McAllen', country: 'US', lat: 26.18, lon: -98.24, population: 1.0, tier: 'regional' },
  { code: 'MLU', name: 'Monroe Regional', city: 'Monroe LA', country: 'US', lat: 32.51, lon: -92.04, population: 0.2, tier: 'regional' },
  { code: 'MOD', name: 'Modesto City-County', city: 'Modesto', country: 'US', lat: 37.63, lon: -120.95, population: 0.5, tier: 'regional' },
  { code: 'OTZ', name: 'Ralph Wien Memorial', city: 'Kotzebue', country: 'US', lat: 66.88, lon: -162.6, population: 0.003, tier: 'regional' },
  { code: 'PIH', name: 'Pocatello Regional', city: 'Pocatello', country: 'US', lat: 42.91, lon: -112.6, population: 0.08, tier: 'regional' },
  { code: 'PUB', name: 'Pueblo Memorial Airport', city: 'Pueblo CO', country: 'US', lat: 38.29, lon: -104.5, population: 0.1, tier: 'regional' },
  { code: 'SGF', name: 'Springfield-Branson Natl', city: 'Springfield MO', country: 'US', lat: 37.25, lon: -93.39, population: 0.5, tier: 'regional' },
  { code: 'SJT', name: 'Mathis Field', city: 'San Angelo', country: 'US', lat: 31.36, lon: -100.5, population: 0.1, tier: 'regional' },
  { code: 'TXK', name: 'Texarkana Regional', city: 'Texarkana', country: 'US', lat: 33.45, lon: -93.99, population: 0.1, tier: 'regional' },
  { code: 'TYR', name: 'Tyler Pounds Regional', city: 'Tyler TX', country: 'US', lat: 32.35, lon: -95.4, population: 0.2, tier: 'regional' },
  { code: 'VLD', name: 'Valdosta Regional', city: 'Valdosta', country: 'US', lat: 30.78, lon: -83.28, population: 0.1, tier: 'regional' },
  { code: 'VPS', name: 'Destin-Fort Walton Beach', city: 'Fort Walton Beach', country: 'US', lat: 30.48, lon: -86.52, population: 0.3, tier: 'regional' },
  { code: 'WRG', name: 'Wrangell Airport', city: 'Wrangell', country: 'US', lat: 56.48, lon: -132.37, population: 0.003, tier: 'regional' },
  { code: 'YQQ', name: 'CFB Comox', city: 'Comox', country: 'CA', lat: 49.71, lon: -124.88, population: 0.07, tier: 'regional' },
  { code: 'YBR', name: 'Brandon Municipal Airport', city: 'Brandon MB', country: 'CA', lat: 49.91, lon: -99.95, population: 0.05, tier: 'regional' },
  { code: 'YPR', name: 'Prince Rupert Airport', city: 'Prince Rupert', country: 'CA', lat: 54.29, lon: -130.44, population: 0.02, tier: 'regional' },
  { code: 'YXJ', name: 'Fort St. John Airport', city: 'Fort St. John', country: 'CA', lat: 56.24, lon: -120.74, population: 0.03, tier: 'regional' },
  { code: 'YKF', name: 'Region of Waterloo Intl', city: 'Waterloo ON', country: 'CA', lat: 43.46, lon: -80.38, population: 0.6, tier: 'regional' },
  { code: 'ITO', name: 'Hilo Intl', city: 'Hilo', country: 'US', lat: 19.72, lon: -155.05, population: 0.05, tier: 'regional' },
  { code: 'LIH', name: 'Lihue Airport', city: 'Lihue', country: 'US', lat: 21.98, lon: -159.34, population: 0.08, tier: 'regional' },
  { code: 'PDL', name: 'Ponta Delgada Airport', city: 'Ponta Delgada', country: 'PT', lat: 37.74, lon: -25.7, population: 0.06, tier: 'regional' },
  { code: 'GNB', name: 'Grenoble-Isere Airport', city: 'Grenoble', country: 'FR', lat: 45.36, lon: 5.33, population: 0.7, tier: 'regional' },
  { code: 'CMF', name: 'Chambery-Savoie Airport', city: 'Chambery', country: 'FR', lat: 45.64, lon: 5.88, population: 0.2, tier: 'regional' },
  { code: 'MPL', name: 'Montpellier Mediterranean', city: 'Montpellier', country: 'FR', lat: 43.58, lon: 3.96, population: 0.6, tier: 'regional' },
  { code: 'ETZ', name: 'Metz-Nancy-Lorraine Airport', city: 'Metz', country: 'FR', lat: 48.98, lon: 6.25, population: 0.5, tier: 'regional' },
  { code: 'RNS', name: 'Rennes-Saint-Jacques Airport', city: 'Rennes', country: 'FR', lat: 48.07, lon: -1.73, population: 0.7, tier: 'regional' },
  { code: 'CFE', name: 'Clermont-Ferrand Auvergne', city: 'Clermont-Ferrand', country: 'FR', lat: 45.79, lon: 3.17, population: 0.3, tier: 'regional' },
  { code: 'YGK', name: 'Kingston Norman Rogers', city: 'Kingston ON', country: 'CA', lat: 44.22, lon: -76.6, population: 0.17, tier: 'regional' },
  { code: 'BIQ', name: 'Biarritz Pays Basque Airport', city: 'Biarritz', country: 'FR', lat: 43.47, lon: -1.53, population: 0.2, tier: 'regional' },
  { code: 'LRH', name: 'La Rochelle-Ile de Re Airport', city: 'La Rochelle', country: 'FR', lat: 46.18, lon: -1.2, population: 0.2, tier: 'regional' },
  { code: 'TUF', name: 'Tours Val de Loire Airport', city: 'Tours', country: 'FR', lat: 47.43, lon: 0.73, population: 0.3, tier: 'regional' },
  { code: 'MXN', name: 'Morlaix-Ploujean Airport', city: 'Morlaix', country: 'FR', lat: 48.6, lon: -3.82, population: 0.06, tier: 'regional' },
  { code: 'VLL', name: 'Valladolid Airport', city: 'Valladolid', country: 'ES', lat: 41.71, lon: -4.85, population: 0.3, tier: 'regional' },
  { code: 'ZAZ', name: 'Zaragoza Airport', city: 'Zaragoza', country: 'ES', lat: 41.66, lon: -1.04, population: 0.7, tier: 'regional' },
  { code: 'OVD', name: 'Asturias Airport', city: 'Oviedo', country: 'ES', lat: 43.56, lon: -6.03, population: 0.4, tier: 'regional' },
  { code: 'LEN', name: 'Leon Airport', city: 'Leon', country: 'ES', lat: 42.59, lon: -5.66, population: 0.1, tier: 'regional' },
  { code: 'REU', name: 'Reus Airport', city: 'Reus', country: 'ES', lat: 41.15, lon: 1.17, population: 0.1, tier: 'regional' },
  { code: 'MJV', name: 'Murcia-San Javier Airport', city: 'Murcia', country: 'ES', lat: 37.78, lon: -0.81, population: 0.5, tier: 'regional' },
  { code: 'GRX', name: 'Federico Garcia Lorca Airport', city: 'Granada', country: 'ES', lat: 37.19, lon: -3.78, population: 0.2, tier: 'regional' },
  { code: 'LEI', name: 'Almeria Airport', city: 'Almeria', country: 'ES', lat: 36.85, lon: -2.37, population: 0.2, tier: 'regional' },
  { code: 'XRY', name: 'Jerez Airport', city: 'Jerez', country: 'ES', lat: 36.74, lon: -6.06, population: 0.2, tier: 'regional' },
  { code: 'CIY', name: 'Comiso Airport', city: 'Comiso', country: 'IT', lat: 36.99, lon: 14.61, population: 0.05, tier: 'regional' },
  { code: 'PMF', name: 'Parma Giuseppe Verdi', city: 'Parma', country: 'IT', lat: 44.82, lon: 10.3, population: 0.4, tier: 'regional' },
  { code: 'BGY', name: 'Bergamo Orio al Serio Airport', city: 'Bergamo', country: 'IT', lat: 45.67, lon: 9.7, population: 1.1, tier: 'regional' },
  { code: 'BRI', name: 'Bari Karol Wojtyla Airport', city: 'Bari', country: 'IT', lat: 41.14, lon: 16.76, population: 1.3, tier: 'regional' },
  { code: 'GOA', name: 'Cristoforo Colombo Intl', city: 'Genoa', country: 'IT', lat: 44.41, lon: 8.84, population: 0.8, tier: 'regional' },
  { code: 'BSL', name: 'EuroAirport Basel-Mulhouse', city: 'Basel', country: 'CH', lat: 47.6, lon: 7.53, population: 0.6, tier: 'regional' },
  { code: 'BRN', name: 'Bern Airport', city: 'Bern', country: 'CH', lat: 46.91, lon: 7.5, population: 0.4, tier: 'regional' },
  { code: 'ABR', name: 'Aberdeen Regional', city: 'Aberdeen SD', country: 'US', lat: 45.45, lon: -98.42, population: 0.03, tier: 'regional' },
  { code: 'ADK', name: 'Adak Airport', city: 'Adak', country: 'US', lat: 51.88, lon: -176.64, population: 0.003, tier: 'regional' },
  { code: 'BTM', name: 'Bert Mooney Airport', city: 'Butte MT', country: 'US', lat: 45.95, lon: -112.5, population: 0.04, tier: 'regional' },
  { code: 'CDV', name: 'Merle K Smith Airport', city: 'Cordova AK', country: 'US', lat: 60.49, lon: -145.48, population: 0.003, tier: 'regional' },
  { code: 'CLD', name: 'McClellan-Palomar Airport', city: 'Carlsbad CA', country: 'US', lat: 33.13, lon: -117.28, population: 0.9, tier: 'regional' },
  { code: 'CNY', name: 'Moab Regional Airport', city: 'Moab UT', country: 'US', lat: 38.76, lon: -109.75, population: 0.01, tier: 'regional' },
  { code: 'COD', name: 'Yellowstone Regional', city: 'Cody WY', country: 'US', lat: 44.52, lon: -109.02, population: 0.01, tier: 'regional' },
  { code: 'DIK', name: 'Dickinson Theodore Roosevelt', city: 'Dickinson ND', country: 'US', lat: 46.8, lon: -102.8, population: 0.03, tier: 'regional' },
  { code: 'DVN', name: 'Quad City Intl', city: 'Davenport IA', country: 'US', lat: 41.61, lon: -90.58, population: 0.4, tier: 'regional' },
  { code: 'EGE', name: 'Eagle County Regional', city: 'Eagle CO', country: 'US', lat: 39.64, lon: -106.92, population: 0.06, tier: 'regional' },
  { code: 'ERI', name: 'Erie Intl', city: 'Erie PA', country: 'US', lat: 42.08, lon: -80.18, population: 0.3, tier: 'regional' },
  { code: 'ESC', name: 'Delta County Airport', city: 'Escanaba MI', country: 'US', lat: 45.72, lon: -87.09, population: 0.03, tier: 'regional' },
  { code: 'EWN', name: 'Coastal Carolina Regional', city: 'New Bern NC', country: 'US', lat: 35.07, lon: -77.04, population: 0.1, tier: 'regional' },
  { code: 'GTU', name: 'Georgetown Municipal', city: 'Georgetown TX', country: 'US', lat: 30.68, lon: -97.68, population: 0.08, tier: 'regional' },
  { code: 'HOM', name: 'Homer Airport', city: 'Homer AK', country: 'US', lat: 59.65, lon: -151.48, population: 0.01, tier: 'regional' },
  { code: 'HSP', name: 'Ingalls Field', city: 'Hot Springs VA', country: 'US', lat: 38.26, lon: -79.83, population: 0.01, tier: 'regional' },
  { code: 'HVR', name: 'Havre City-County Airport', city: 'Havre MT', country: 'US', lat: 48.54, lon: -109.76, population: 0.01, tier: 'regional' },
  { code: 'IMT', name: 'Ford Airport', city: 'Iron Mountain MI', country: 'US', lat: 45.82, lon: -88.11, population: 0.03, tier: 'regional' },
  { code: 'INL', name: 'Falls Intl', city: 'International Falls MN', country: 'US', lat: 48.57, lon: -93.4, population: 0.01, tier: 'regional' },
  { code: 'ISN', name: 'Sloulin Field Intl', city: 'Williston ND', country: 'US', lat: 48.18, lon: -103.64, population: 0.05, tier: 'regional' },
  { code: 'IYK', name: 'Inyokern Airport', city: 'Inyokern CA', country: 'US', lat: 35.66, lon: -117.83, population: 0.01, tier: 'regional' },
  { code: 'JMS', name: 'Jamestown Regional', city: 'Jamestown ND', country: 'US', lat: 46.93, lon: -98.68, population: 0.02, tier: 'regional' },
  { code: 'LAM', name: 'Los Alamos Airport', city: 'Los Alamos NM', country: 'US', lat: 35.88, lon: -106.27, population: 0.02, tier: 'regional' },
  { code: 'MHK', name: 'Manhattan Regional', city: 'Manhattan KS', country: 'US', lat: 39.14, lon: -96.67, population: 0.07, tier: 'regional' },
  { code: 'MLS', name: 'Frank Wiley Field', city: 'Miles City MT', country: 'US', lat: 46.43, lon: -105.89, population: 0.01, tier: 'regional' },
  { code: 'MSO', name: 'Missoula Montana Airport', city: 'Missoula', country: 'US', lat: 46.92, lon: -114.09, population: 0.1, tier: 'regional' },
  { code: 'MTO', name: 'Coles County Memorial', city: 'Mattoon IL', country: 'US', lat: 39.48, lon: -88.28, population: 0.03, tier: 'regional' },
  { code: 'OGD', name: 'Ogden-Hinckley Airport', city: 'Ogden UT', country: 'US', lat: 41.2, lon: -112.01, population: 0.8, tier: 'regional' },
  { code: 'OME', name: 'Nome Airport', city: 'Nome AK', country: 'US', lat: 64.51, lon: -165.44, population: 0.003, tier: 'regional' },
  { code: 'PAH', name: 'Barkley Regional Airport', city: 'Paducah KY', country: 'US', lat: 37.06, lon: -88.77, population: 0.1, tier: 'regional' },
  { code: 'PGA', name: 'Page Municipal Airport', city: 'Page AZ', country: 'US', lat: 36.93, lon: -111.45, population: 0.01, tier: 'regional' },
  { code: 'PIR', name: 'Pierre Regional Airport', city: 'Pierre SD', country: 'US', lat: 44.38, lon: -100.28, population: 0.02, tier: 'regional' },
  { code: 'PRC', name: 'Prescott Regional Airport', city: 'Prescott AZ', country: 'US', lat: 34.65, lon: -112.42, population: 0.1, tier: 'regional' },
  { code: 'PSC', name: 'Tri-Cities Airport', city: 'Pasco WA', country: 'US', lat: 46.26, lon: -119.12, population: 0.3, tier: 'regional' },
  { code: 'RDM', name: 'Roberts Field', city: 'Redmond OR', country: 'US', lat: 44.25, lon: -121.15, population: 0.2, tier: 'regional' },
  { code: 'RKS', name: 'Southwest Wyoming Regional', city: 'Rock Springs WY', country: 'US', lat: 41.6, lon: -109.07, population: 0.03, tier: 'regional' },
  { code: 'SCE', name: 'University Park Airport', city: 'State College PA', country: 'US', lat: 40.85, lon: -77.85, population: 0.1, tier: 'regional' },
  { code: 'SIT', name: 'Sitka Rocky Gutierrez Airport', city: 'Sitka AK', country: 'US', lat: 57.05, lon: -135.36, population: 0.01, tier: 'regional' },
  { code: 'SLN', name: 'Salina Regional Airport', city: 'Salina KS', country: 'US', lat: 38.79, lon: -97.65, population: 0.05, tier: 'regional' },
  { code: 'SMX', name: 'Santa Maria Airport', city: 'Santa Maria CA', country: 'US', lat: 34.9, lon: -120.46, population: 0.2, tier: 'regional' },
  { code: 'STC', name: 'St Cloud Regional Airport', city: 'St Cloud MN', country: 'US', lat: 45.54, lon: -94.06, population: 0.1, tier: 'regional' },
  { code: 'TEX', name: 'Telluride Regional Airport', city: 'Telluride CO', country: 'US', lat: 37.95, lon: -107.9, population: 0.02, tier: 'regional' },
  { code: 'TWF', name: 'Magic Valley Regional', city: 'Twin Falls ID', country: 'US', lat: 42.48, lon: -114.49, population: 0.08, tier: 'regional' },
  { code: 'VEL', name: 'Vernal Regional Airport', city: 'Vernal UT', country: 'US', lat: 40.44, lon: -109.51, population: 0.01, tier: 'regional' },
  { code: 'WYS', name: 'Yellowstone Airport', city: 'West Yellowstone MT', country: 'US', lat: 44.69, lon: -111.12, population: 0.01, tier: 'regional' },
  { code: 'YUM', name: 'Yuma Intl Airport', city: 'Yuma AZ', country: 'US', lat: 32.66, lon: -114.61, population: 0.1, tier: 'regional' },
  { code: 'ANU', name: 'V.C. Bird Intl', city: 'St. Johns Antigua', country: 'AG', lat: 17.14, lon: -61.79, population: 0.1, tier: 'regional' },
  { code: 'GND', name: 'Maurice Bishop Intl', city: 'St. George Grenada', country: 'GD', lat: 12.0, lon: -61.79, population: 0.1, tier: 'regional' },
  { code: 'SKB', name: 'Robert Llewellyn Bradshaw Intl', city: 'Basseterre', country: 'KN', lat: 17.31, lon: -62.72, population: 0.05, tier: 'regional' },
  { code: 'SXB', name: 'Strasbourg Airport', city: 'Strasbourg', country: 'FR', lat: 48.54, lon: 7.63, population: 0.5, tier: 'regional' },
  { code: 'LIG', name: 'Limoges Airport', city: 'Limoges', country: 'FR', lat: 45.86, lon: 1.18, population: 0.2, tier: 'regional' },
  { code: 'PGF', name: 'Perpignan Airport', city: 'Perpignan', country: 'FR', lat: 42.74, lon: 2.87, population: 0.3, tier: 'regional' },
  { code: 'FSC', name: 'Figari Sud Corse Airport', city: 'Figari', country: 'FR', lat: 41.5, lon: 9.1, population: 0.05, tier: 'regional' },
  { code: 'KLU', name: 'Klagenfurt Airport', city: 'Klagenfurt', country: 'AT', lat: 46.64, lon: 14.34, population: 0.1, tier: 'regional' },
  { code: 'WIC', name: 'Wick Airport', city: 'Wick', country: 'GB', lat: 58.46, lon: -3.09, population: 0.01, tier: 'regional' },
  { code: 'LSI', name: 'Sumburgh Airport', city: 'Lerwick Shetland', country: 'GB', lat: 59.88, lon: -1.3, population: 0.02, tier: 'regional' },
  { code: 'KOI', name: 'Kirkwall Airport', city: 'Kirkwall Orkney', country: 'GB', lat: 58.96, lon: -2.9, population: 0.02, tier: 'regional' },
  { code: 'IOM', name: 'Isle of Man Airport', city: 'Castletown', country: 'IM', lat: 54.08, lon: -4.62, population: 0.08, tier: 'regional' },

  // ── EXPANSION: scored additions (tools/airport-expansion) ────────────────────
  // Passed both gates (distinct >=90km from existing, viable >=150 pax/wk) on the
  // game's own gravity model. See tools/airport-expansion/scored-candidates.csv.
  // East Asia (Chinese secondary metros)
  { code: 'NTG', name: 'Nantong Xingdong',         city: 'Nantong',        country: 'CN', lat: 32.07, lon: 120.98, population: 7.7, tier: 'regional' },
  { code: 'WUX', name: 'Sunan Shuofang Intl',      city: 'Wuxi',           country: 'CN', lat: 31.49, lon: 120.43, population: 7.5, tier: 'regional' },
  { code: 'ZHA', name: 'Zhanjiang Wuchuan',        city: 'Zhanjiang',      country: 'CN', lat: 21.21, lon: 110.36, population: 7.0, tier: 'major'    },
  { code: 'SWA', name: 'Jieyang Chaoshan Intl',    city: 'Shantou',        country: 'CN', lat: 23.55, lon: 116.50, population: 5.6, tier: 'major'    },
  { code: 'DYG', name: 'Zhangjiajie Hehua Intl',   city: 'Zhangjiajie',    country: 'CN', lat: 29.10, lon: 110.44, population: 1.5, tier: 'regional' },
  { code: 'JHG', name: 'Xishuangbanna Gasa',       city: 'Jinghong',       country: 'CN', lat: 21.97, lon: 100.76, population: 1.3, tier: 'regional' },
  // South & Southeast Asia
  { code: 'UDR', name: 'Maharana Pratap',          city: 'Udaipur',        country: 'IN', lat: 24.62, lon: 73.90,  population: 0.9, tier: 'regional' },
  { code: 'URT', name: 'Surat Thani Intl',         city: 'Surat Thani',    country: 'TH', lat: 9.13,  lon: 99.14,  population: 1.0, tier: 'regional' },
  { code: 'CXR', name: 'Cam Ranh Intl',            city: 'Nha Trang',      country: 'VN', lat: 11.99, lon: 109.22, population: 0.5, tier: 'regional' },
  { code: 'LPQ', name: 'Luang Prabang Intl',       city: 'Luang Prabang',  country: 'LA', lat: 19.90, lon: 102.16, population: 0.1, tier: 'regional' },
  { code: 'CGY', name: 'Laguindingan',             city: 'Cagayan de Oro', country: 'PH', lat: 8.61,  lon: 124.46, population: 0.9, tier: 'regional' },
  // Indonesia (archipelago)
  { code: 'BDO', name: 'Husein Sastranegara',      city: 'Bandung',        country: 'ID', lat: -6.90, lon: 107.58, population: 8.5, tier: 'major'    },
  { code: 'PNK', name: 'Supadio',                  city: 'Pontianak',      country: 'ID', lat: -0.15, lon: 109.40, population: 1.0, tier: 'regional' },
  { code: 'KOE', name: 'El Tari',                  city: 'Kupang',         country: 'ID', lat: -10.17,lon: 123.67, population: 0.5, tier: 'regional' },
  { code: 'AMQ', name: 'Pattimura',                city: 'Ambon',          country: 'ID', lat: -3.71, lon: 128.09, population: 0.4, tier: 'regional' },
  { code: 'DJJ', name: 'Sentani',                  city: 'Jayapura',       country: 'ID', lat: -2.58, lon: 140.52, population: 0.4, tier: 'regional' },
  // Middle East / Central Asia / Caribbean
  { code: 'RAK', name: 'Marrakesh Menara',         city: 'Marrakesh',      country: 'MA', lat: 31.61, lon: -8.04,  population: 1.5, tier: 'regional' },
  { code: 'SKD', name: 'Samarkand Intl',           city: 'Samarkand',      country: 'UZ', lat: 39.70, lon: 66.98,  population: 0.6, tier: 'regional' },
  { code: 'AUA', name: 'Queen Beatrix Intl',       city: 'Oranjestad',     country: 'AW', lat: 12.50, lon: -70.01, population: 0.1, tier: 'regional' },

  // ── EXPANSION: iconic / novelty ──────────────────────────────────────────────
  { code: 'DIL', name: 'Pres. Nicolau Lobato Intl', city: 'Dili', country: 'TL', lat: -8.55, lon: 125.53, population: 0.28, tier: 'regional' },
  { code: 'PBH', name: 'Paro Intl', city: 'Paro', country: 'BT', lat: 27.4, lon: 89.42, population: 0.1, tier: 'regional' },
  { code: 'USH', name: 'Malvinas Argentinas', city: 'Ushuaia', country: 'AR', lat: -54.84, lon: -68.3, population: 0.08, tier: 'regional' },
  { code: 'FAE', name: 'Vagar', city: 'Sorvagur', country: 'FO', lat: 62.06, lon: -7.27, population: 0.05, tier: 'regional' },
  { code: 'GOH', name: 'Nuuk Intl', city: 'Nuuk', country: 'GL', lat: 64.19, lon: -51.68, population: 0.019, tier: 'regional' },
  { code: 'DCY', name: 'Daocheng Yading', city: 'Daocheng', country: 'CN', lat: 29.32, lon: 100.05, population: 0.03, tier: 'regional' },
  { code: 'BPX', name: 'Qamdo Bamda', city: 'Qamdo', country: 'CN', lat: 30.55, lon: 97.11, population: 0.06, tier: 'regional' },
  { code: 'LUA', name: 'Tenzing-Hillary', city: 'Lukla', country: 'NP', lat: 27.69, lon: 86.73, population: 0.005, tier: 'regional' },
  { code: 'HGU', name: 'Mount Hagen Kagamuga', city: 'Mount Hagen', country: 'PG', lat: -5.83, lon: 144.3, population: 0.03, tier: 'regional' },
  { code: 'PPG', name: 'Pago Pago Intl', city: 'Pago Pago', country: 'AS', lat: -14.33, lon: -170.71, population: 0.05, tier: 'regional' },
  { code: 'IPC', name: 'Mataveri', city: 'Easter Island', country: 'CL', lat: -27.16, lon: -109.42, population: 0.008, tier: 'regional' },
  { code: 'INU', name: 'Nauru Intl', city: 'Yaren', country: 'NR', lat: -0.55, lon: 166.92, population: 0.01, tier: 'regional' },
  { code: 'GIS', name: 'Gisborne', city: 'Gisborne', country: 'NZ', lat: -38.66, lon: 177.98, population: 0.05, tier: 'regional' },
  { code: 'FSP', name: 'St-Pierre Pointe Blanche', city: 'St-Pierre', country: 'PM', lat: 46.76, lon: -56.17, population: 0.006, tier: 'regional' },
  { code: 'MNK', name: 'Maumere Frans Seda', city: 'Maumere', country: 'ID', lat: -8.64, lon: 122.24, population: 0.07, tier: 'regional' },
  { code: 'BRR', name: 'Barra', city: 'Barra', country: 'GB', lat: 57.02, lon: -7.44, population: 0.001, tier: 'regional' },
  { code: 'LYR', name: 'Svalbard Longyear', city: 'Longyearbyen', country: 'NO', lat: 78.25, lon: 15.46, population: 0.002, tier: 'regional' },
  { code: 'HLE', name: 'St Helena', city: 'Jamestown', country: 'SH', lat: -15.96, lon: -5.65, population: 0.004, tier: 'regional' },
  { code: 'SAB', name: 'Juancho Yrausquin', city: 'Saba', country: 'BQ', lat: 17.64, lon: -63.22, population: 0.002, tier: 'regional' },
  { code: 'SBH', name: 'Gustaf III', city: 'Gustavia', country: 'BL', lat: 17.9, lon: -62.84, population: 0.01, tier: 'regional' },
  { code: 'GIB', name: 'Gibraltar Intl', city: 'Gibraltar', country: 'GI', lat: 36.15, lon: -5.35, population: 0.03, tier: 'regional' },
  { code: 'CVF', name: 'Courchevel Altiport', city: 'Courchevel', country: 'FR', lat: 45.4, lon: 6.63, population: 0.002, tier: 'regional' },
  { code: 'SFJ', name: 'Kangerlussuaq', city: 'Kangerlussuaq', country: 'GL', lat: 67.01, lon: -50.71, population: 0.001, tier: 'regional' },
  { code: 'NLK', name: 'Norfolk Island', city: 'Burnt Pine', country: 'NF', lat: -29.04, lon: 167.94, population: 0.002, tier: 'regional' },
  { code: 'AXA', name: 'Clayton J Lloyd', city: 'The Valley', country: 'AI', lat: 18.2, lon: -63.06, population: 0.01, tier: 'regional' },
  { code: 'VQS', name: 'Antonio Rivera', city: 'Vieques', country: 'US', lat: 18.13, lon: -65.49, population: 0.009, tier: 'regional' },
  { code: 'SDU', name: 'Santos Dumont', city: 'Rio de Janeiro', country: 'BR', lat: -22.91, lon: -43.16, population: 13.6, tier: 'regional' },
  // ── EXPANSION: UN member coverage (primary intl airport) ─────────────────────
  { code: 'BJM', name: 'Bujumbura Intl', city: 'Bujumbura', country: 'BI', lat: -3.32, lon: 29.32, population: 1.1, tier: 'regional' },
  { code: 'HAH', name: 'Prince Said Ibrahim', city: 'Moroni', country: 'KM', lat: -11.53, lon: 43.27, population: 0.7, tier: 'regional' },
  { code: 'DOM', name: 'Douglas-Charles', city: 'Marigot', country: 'DM', lat: 15.55, lon: -61.3, population: 0.07, tier: 'regional' },
  { code: 'SSG', name: 'Malabo Intl', city: 'Malabo', country: 'GQ', lat: 3.76, lon: 8.71, population: 0.3, tier: 'regional' },
  { code: 'SHO', name: 'King Mswati III', city: 'Manzini', country: 'SZ', lat: -26.36, lon: 31.72, population: 0.4, tier: 'regional' },
  { code: 'CKY', name: 'Conakry Intl', city: 'Conakry', country: 'GN', lat: 9.58, lon: -13.61, population: 2, tier: 'regional' },
  { code: 'PAP', name: 'Toussaint Louverture', city: 'Port-au-Prince', country: 'HT', lat: 18.58, lon: -72.29, population: 2.8, tier: 'regional' },
  { code: 'FNJ', name: 'Pyongyang Sunan Intl', city: 'Pyongyang', country: 'KP', lat: 39.22, lon: 125.67, population: 3, tier: 'regional' },
  { code: 'MSU', name: 'Moshoeshoe I Intl', city: 'Maseru', country: 'LS', lat: -29.46, lon: 27.55, population: 0.4, tier: 'regional' },
  { code: 'ROB', name: 'Roberts Intl', city: 'Monrovia', country: 'LR', lat: 6.23, lon: -10.36, population: 1.6, tier: 'regional' },
  { code: 'MLE', name: 'Velana Intl', city: 'Male', country: 'MV', lat: 4.19, lon: 73.53, population: 0.4, tier: 'major' },
  { code: 'MAJ', name: 'Marshall Islands Intl', city: 'Majuro', country: 'MH', lat: 7.06, lon: 171.27, population: 0.03, tier: 'regional' },
  { code: 'PNI', name: 'Pohnpei Intl', city: 'Kolonia', country: 'FM', lat: 6.99, lon: 158.21, population: 0.04, tier: 'regional' },
  { code: 'ULN', name: 'Chinggis Khaan Intl', city: 'Ulaanbaatar', country: 'MN', lat: 47.84, lon: 106.77, population: 1.6, tier: 'major' },
  { code: 'ROR', name: 'Roman Tmetuchl Intl', city: 'Koror', country: 'PW', lat: 7.37, lon: 134.54, population: 0.02, tier: 'regional' },
  { code: 'UVF', name: 'Hewanorra Intl', city: 'Vieux Fort', country: 'LC', lat: 13.73, lon: -60.95, population: 0.18, tier: 'regional' },
  { code: 'SVD', name: 'Argyle Intl', city: 'Kingstown', country: 'VC', lat: 13.16, lon: -61.15, population: 0.11, tier: 'regional' },
  { code: 'FNA', name: 'Lungi Intl', city: 'Freetown', country: 'SL', lat: 8.62, lon: -13.2, population: 1.3, tier: 'regional' },
  { code: 'JUB', name: 'Juba Intl', city: 'Juba', country: 'SS', lat: 4.87, lon: 31.6, population: 0.5, tier: 'regional' },
  { code: 'DAM', name: 'Damascus Intl', city: 'Damascus', country: 'SY', lat: 33.41, lon: 36.51, population: 2.5, tier: 'regional' },
  { code: 'FUN', name: 'Funafuti Intl', city: 'Funafuti', country: 'TV', lat: -8.52, lon: 179.2, population: 0.006, tier: 'regional' },
];

export function getAirport(code) {
  return AIRPORTS.find(a => a.code === code);
}

// ─── Gate pricing ──────────────────────────────────────────────────────────────

/** Monthly gate rental cost by airport tier. */
export const GATE_FEE_BY_TIER = {
  mega:     120_000,   // LHR, JFK, ORD, ATL, DFW, FRA, AMS …
  major:     70_000,   // SFO, MIA, BOS, ZRH …
  regional:  30_000,   // smaller city airports
};

/**
 * Marginal cost escalation per additional gate.
 * Each gate costs this much MORE (proportionally) than the previous one.
 * mega: +10% / gate, major: +5% / gate, regional: +2% / gate.
 */
export const GATE_COST_ESCALATION = {
  mega:     1.10,
  major:    1.05,
  regional: 1.02,
};

/**
 * Monthly fee for the Nth gate at an airport (1-indexed).
 * Gate 1 = base rate; gate 2 = base × escalation; gate N = base × escalation^(N-1).
 *
 * @param {object} airport  - airport record from AIRPORTS
 * @param {number} [n=1]    - which gate number (1 = first gate)
 */
export function gateMonthlyFee(airport, n = 1) {
  const base = GATE_FEE_BY_TIER[airport?.tier] ?? 50_000;
  const rate = GATE_COST_ESCALATION[airport?.tier] ?? 1.05;
  return Math.round(base * Math.pow(rate, n - 1));
}

/**
 * Total monthly cost for holding `count` gates at an airport.
 * = sum of gateMonthlyFee(airport, 1..count)
 * = base × (rate^count − 1) / (rate − 1)   when rate ≠ 1
 *
 * @param {object} airport  - airport record from AIRPORTS
 * @param {number} count    - number of gates held
 */
export function totalGateMonthlyFee(airport, count) {
  if (!count || count <= 0) return 0;
  const base = GATE_FEE_BY_TIER[airport?.tier] ?? 50_000;
  const rate = GATE_COST_ESCALATION[airport?.tier] ?? 1.05;
  if (rate === 1) return base * count;
  return Math.round(base * (Math.pow(rate, count) - 1) / (rate - 1));
}

// ─── Per-airport business / leisure scores ─────────────────────────────────────
//
// businessScore (0–100): how corporate/premium-oriented this airport is.
//   High = lots of suits flying in for meetings.
// leisureScore  (0–100): how tourism/holiday-oriented this airport is.
//   High = beach bags and selfie sticks. These are INDEPENDENT — a big mixed
//   hub like JFK can score well on both; a tiny ski resort scores low on both.
//
// Unlisted airports fall back to getAirportScores() which uses tier defaults.

export const AIRPORT_SCORES = {
  // ── North America – major hubs ──────────────────────────────────────────────
  JFK: { businessScore: 72, leisureScore: 65 },   // finance capital + global tourism
  LAX: { businessScore: 62, leisureScore: 72 },   // entertainment industry + sunshine tourism
  ORD: { businessScore: 68, leisureScore: 40 },   // Midwest business hub
  ATL: { businessScore: 65, leisureScore: 45 },
  DFW: { businessScore: 65, leisureScore: 38 },
  DEN: { businessScore: 58, leisureScore: 55 },   // ski + business
  SFO: { businessScore: 72, leisureScore: 58 },   // tech corridor + Golden Gate tourism
  SEA: { businessScore: 65, leisureScore: 55 },   // tech hub (Amazon/Boeing)
  MIA: { businessScore: 60, leisureScore: 68 },   // trade hub + beach
  BOS: { businessScore: 70, leisureScore: 52 },   // academia / finance
  PHX: { businessScore: 55, leisureScore: 50 },
  IAD: { businessScore: 78, leisureScore: 28 },   // DC govt/defense – low leisure
  DCA: { businessScore: 82, leisureScore: 30 },   // Reagan National – premium business/govt shuttle
  IAH: { businessScore: 65, leisureScore: 38 },   // Houston energy sector
  MSP: { businessScore: 60, leisureScore: 40 },
  DTW: { businessScore: 62, leisureScore: 38 },
  PHL: { businessScore: 62, leisureScore: 40 },
  CLT: { businessScore: 60, leisureScore: 40 },
  EWR: { businessScore: 68, leisureScore: 55 },   // NYC metro overflow
  LGA: { businessScore: 70, leisureScore: 50 },   // NYC shuttle – heavy business

  // ── North America – leisure ─────────────────────────────────────────────────
  LAS: { businessScore: 15, leisureScore: 90 },   // Vegas – conventions exist but it's leisure
  MCO: { businessScore: 12, leisureScore: 92 },   // Orlando – Disney/Universal
  HNL: { businessScore: 18, leisureScore: 88 },   // Honolulu
  OGG: { businessScore:  5, leisureScore: 96 },   // Maui – pure resort
  KOA: { businessScore:  5, leisureScore: 96 },   // Kona – pure resort
  FLL: { businessScore: 20, leisureScore: 80 },
  TPA: { businessScore: 28, leisureScore: 65 },
  PBI: { businessScore: 22, leisureScore: 72 },   // Palm Beach – wealthy leisure
  SJU: { businessScore: 30, leisureScore: 72 },   // San Juan – mixed
  ANC: { businessScore: 35, leisureScore: 55 },   // Anchorage – resource sector

  // ── Canada ──────────────────────────────────────────────────────────────────
  YYZ: { businessScore: 65, leisureScore: 48 },
  YVR: { businessScore: 60, leisureScore: 62 },   // gateway + scenic
  YUL: { businessScore: 62, leisureScore: 52 },

  // ── Mexico / Central America ────────────────────────────────────────────────
  MEX: { businessScore: 65, leisureScore: 55 },
  CUN: { businessScore:  8, leisureScore: 92 },   // Cancún – resort town
  GDL: { businessScore: 55, leisureScore: 50 },
  PTY: { businessScore: 55, leisureScore: 55 },   // Panama City – regional hub

  // ── Caribbean ───────────────────────────────────────────────────────────────
  MBJ: { businessScore:  5, leisureScore: 94 },
  NAS: { businessScore:  8, leisureScore: 92 },
  BGI: { businessScore:  5, leisureScore: 94 },
  SXM: { businessScore:  5, leisureScore: 96 },
  GCM: { businessScore: 10, leisureScore: 90 },
  SDQ: { businessScore: 20, leisureScore: 78 },
  POS: { businessScore: 35, leisureScore: 62 },   // Port of Spain – energy/trade
  HAV: { businessScore: 20, leisureScore: 80 },

  // ── South America ────────────────────────────────────────────────────────────
  GRU: { businessScore: 65, leisureScore: 52 },
  GIG: { businessScore: 48, leisureScore: 75 },   // Rio de Janeiro – tourism
  EZE: { businessScore: 62, leisureScore: 55 },
  SCL: { businessScore: 60, leisureScore: 52 },
  BOG: { businessScore: 62, leisureScore: 45 },
  LIM: { businessScore: 58, leisureScore: 50 },
  MDE: { businessScore: 55, leisureScore: 52 },
  CLO: { businessScore: 50, leisureScore: 48 },

  // ── Europe – major hubs ──────────────────────────────────────────────────────
  LHR: { businessScore: 82, leisureScore: 55 },   // global finance + heavy tourism
  CDG: { businessScore: 75, leisureScore: 65 },   // Paris – business + #1 tourist city
  FRA: { businessScore: 88, leisureScore: 28 },   // financial/industrial – low leisure
  AMS: { businessScore: 78, leisureScore: 55 },
  MAD: { businessScore: 65, leisureScore: 62 },
  BCN: { businessScore: 48, leisureScore: 72 },   // Barcelona – tourism dominant
  FCO: { businessScore: 55, leisureScore: 68 },   // Rome – tourist city
  MXP: { businessScore: 68, leisureScore: 50 },   // Milan – fashion/industry
  MUC: { businessScore: 72, leisureScore: 48 },
  ZRH: { businessScore: 85, leisureScore: 35 },   // banking capital
  VIE: { businessScore: 68, leisureScore: 52 },
  BRU: { businessScore: 75, leisureScore: 38 },   // EU institutions
  LIS: { businessScore: 50, leisureScore: 72 },   // Lisbon – growing tourism
  OSL: { businessScore: 65, leisureScore: 40 },   // oil industry
  ARN: { businessScore: 65, leisureScore: 48 },
  HEL: { businessScore: 62, leisureScore: 45 },
  CPH: { businessScore: 68, leisureScore: 52 },
  DUB: { businessScore: 65, leisureScore: 60 },   // tech (Google/Facebook EMEA) + tourism
  WAW: { businessScore: 60, leisureScore: 40 },
  ATH: { businessScore: 45, leisureScore: 72 },   // shipping business + lots of tourists
  IST: { businessScore: 68, leisureScore: 62 },
  BER: { businessScore: 62, leisureScore: 58 },
  LGW: { businessScore: 45, leisureScore: 72 },   // Gatwick – budget/leisure flights
  LCY: { businessScore: 90, leisureScore: 20 },   // London City – Canary Wharf/finance, almost pure business
  MAN: { businessScore: 58, leisureScore: 60 },
  LYS: { businessScore: 58, leisureScore: 50 },
  NCE: { businessScore: 32, leisureScore: 75 },   // Nice – Riviera leisure
  PRG: { businessScore: 48, leisureScore: 72 },   // Prague – high tourism
  BUD: { businessScore: 50, leisureScore: 68 },
  OTP: { businessScore: 50, leisureScore: 55 },
  SAW: { businessScore: 42, leisureScore: 65 },   // Istanbul Sabiha – leisure/budget

  // ── Europe – beach / leisure ─────────────────────────────────────────────────
  PMI: { businessScore:  8, leisureScore: 92 },   // Palma – Balearic beach
  IBZ: { businessScore:  6, leisureScore: 95 },   // Ibiza
  TFS: { businessScore:  6, leisureScore: 92 },   // Tenerife South
  LPA: { businessScore:  6, leisureScore: 92 },   // Gran Canaria
  AGP: { businessScore:  8, leisureScore: 90 },   // Malaga / Costa del Sol
  FAO: { businessScore:  8, leisureScore: 90 },   // Algarve
  FNC: { businessScore:  6, leisureScore: 90 },   // Madeira
  HER: { businessScore:  5, leisureScore: 93 },   // Heraklion – Crete
  RHO: { businessScore:  5, leisureScore: 93 },   // Rhodes
  JTR: { businessScore:  5, leisureScore: 95 },   // Santorini
  JMK: { businessScore:  4, leisureScore: 96 },   // Mykonos
  CHQ: { businessScore:  5, leisureScore: 92 },   // Chania
  AYT: { businessScore:  7, leisureScore: 92 },   // Antalya
  DLM: { businessScore:  5, leisureScore: 92 },   // Dalaman
  DBV: { businessScore:  7, leisureScore: 93 },   // Dubrovnik
  SPU: { businessScore:  5, leisureScore: 90 },   // Split
  SSH: { businessScore:  5, leisureScore: 92 },   // Sharm el-Sheikh
  HRG: { businessScore:  5, leisureScore: 92 },   // Hurghada

  // ── Middle East ──────────────────────────────────────────────────────────────
  DXB: { businessScore: 80, leisureScore: 65 },   // Dubai – corporate AND shopping/tourism
  DOH: { businessScore: 78, leisureScore: 55 },
  AUH: { businessScore: 75, leisureScore: 58 },
  RUH: { businessScore: 72, leisureScore: 28 },   // Riyadh – restrictive, minimal leisure
  JED: { businessScore: 60, leisureScore: 52 },   // Jeddah – religious + business
  MCT: { businessScore: 58, leisureScore: 55 },

  // ── Africa ───────────────────────────────────────────────────────────────────
  JNB: { businessScore: 62, leisureScore: 50 },
  CPT: { businessScore: 48, leisureScore: 75 },   // Cape Town – major tourism
  CAI: { businessScore: 55, leisureScore: 58 },
  NBO: { businessScore: 58, leisureScore: 45 },
  LOS: { businessScore: 62, leisureScore: 38 },   // Lagos – commercial capital
  CMN: { businessScore: 50, leisureScore: 55 },
  ADD: { businessScore: 52, leisureScore: 42 },

  // ── South & Southeast Asia ───────────────────────────────────────────────────
  SIN: { businessScore: 78, leisureScore: 62 },
  HKG: { businessScore: 82, leisureScore: 58 },
  KUL: { businessScore: 62, leisureScore: 58 },
  BKK: { businessScore: 50, leisureScore: 78 },   // Bangkok – tourism dominant
  CGK: { businessScore: 55, leisureScore: 55 },
  MNL: { businessScore: 52, leisureScore: 58 },
  DEL: { businessScore: 62, leisureScore: 48 },
  BOM: { businessScore: 65, leisureScore: 50 },
  BLR: { businessScore: 72, leisureScore: 38 },   // Bangalore – IT hub
  CMB: { businessScore: 40, leisureScore: 62 },

  // ── East Asia ────────────────────────────────────────────────────────────────
  NRT: { businessScore: 68, leisureScore: 65 },
  HND: { businessScore: 72, leisureScore: 62 },   // Haneda – more domestic/business
  KIX: { businessScore: 58, leisureScore: 62 },
  ICN: { businessScore: 72, leisureScore: 62 },
  PEK: { businessScore: 65, leisureScore: 52 },
  PVG: { businessScore: 72, leisureScore: 58 },
  CAN: { businessScore: 65, leisureScore: 50 },
  TPE: { businessScore: 68, leisureScore: 58 },

  // ── Oceania ──────────────────────────────────────────────────────────────────
  SYD: { businessScore: 65, leisureScore: 72 },   // big business city + iconic tourism
  MEL: { businessScore: 65, leisureScore: 65 },
  BNE: { businessScore: 55, leisureScore: 65 },
  AKL: { businessScore: 58, leisureScore: 68 },

  // ── Expansion: scored additions ──────────────────────────────────────────────
  NTG: { businessScore: 48, leisureScore: 38 },   // Nantong – Yangtze industrial
  WUX: { businessScore: 52, leisureScore: 42 },   // Wuxi – tech/manufacturing
  ZHA: { businessScore: 42, leisureScore: 45 },   // Zhanjiang – port city
  SWA: { businessScore: 45, leisureScore: 45 },   // Shantou – SEZ
  DYG: { businessScore: 10, leisureScore: 92 },   // Zhangjiajie – scenery tourism
  JHG: { businessScore: 12, leisureScore: 85 },   // Xishuangbanna – tropical tourism
  UDR: { businessScore: 18, leisureScore: 85 },   // Udaipur – heritage tourism
  URT: { businessScore: 30, leisureScore: 60 },   // Surat Thani – Samui gateway
  CXR: { businessScore: 15, leisureScore: 88 },   // Nha Trang – beach resort
  LPQ: { businessScore: 10, leisureScore: 88 },   // Luang Prabang – heritage tourism
  CGY: { businessScore: 38, leisureScore: 48 },   // Cagayan de Oro
  BDO: { businessScore: 45, leisureScore: 50 },   // Bandung – diversified metro
  PNK: { businessScore: 35, leisureScore: 45 },   // Pontianak
  KOE: { businessScore: 30, leisureScore: 45 },   // Kupang
  AMQ: { businessScore: 28, leisureScore: 50 },   // Ambon
  DJJ: { businessScore: 32, leisureScore: 40 },   // Jayapura
  RAK: { businessScore: 25, leisureScore: 88 },   // Marrakesh – tourism
  SKD: { businessScore: 15, leisureScore: 85 },   // Samarkand – Silk Road tourism
  AUA: { businessScore: 12, leisureScore: 92 },   // Aruba – beach resort

  // ── Expansion: iconic / novelty ──────────────────────────────────────────────
  DIL: { businessScore: 32, leisureScore: 45 },   // Dili
  PBH: { businessScore: 20, leisureScore: 80 },   // Paro
  USH: { businessScore: 20, leisureScore: 80 },   // Ushuaia
  FAE: { businessScore: 25, leisureScore: 70 },   // Vagar / Faroe
  GOH: { businessScore: 35, leisureScore: 55 },   // Nuuk
  DCY: { businessScore: 10, leisureScore: 90 },   // Daocheng Yading
  BPX: { businessScore: 20, leisureScore: 55 },   // Qamdo Bamda
  LUA: { businessScore: 10, leisureScore: 90 },   // Lukla
  HGU: { businessScore: 32, leisureScore: 40 },   // Mount Hagen
  PPG: { businessScore: 30, leisureScore: 55 },   // Pago Pago
  IPC: { businessScore: 8,  leisureScore: 92 },   // Easter Island
  INU: { businessScore: 30, leisureScore: 40 },   // Nauru
  GIS: { businessScore: 32, leisureScore: 45 },   // Gisborne
  FSP: { businessScore: 30, leisureScore: 40 },   // St-Pierre
  MNK: { businessScore: 28, leisureScore: 55 },   // Maumere
  BRR: { businessScore: 10, leisureScore: 85 },   // Barra
  LYR: { businessScore: 20, leisureScore: 80 },   // Longyearbyen
  HLE: { businessScore: 15, leisureScore: 80 },   // St Helena
  SAB: { businessScore: 10, leisureScore: 90 },   // Saba
  SBH: { businessScore: 20, leisureScore: 90 },   // St Barthelemy
  GIB: { businessScore: 30, leisureScore: 70 },   // Gibraltar
  CVF: { businessScore: 15, leisureScore: 90 },   // Courchevel
  SFJ: { businessScore: 20, leisureScore: 70 },   // Kangerlussuaq
  NLK: { businessScore: 15, leisureScore: 75 },   // Norfolk Island
  AXA: { businessScore: 20, leisureScore: 85 },   // Anguilla
  VQS: { businessScore: 15, leisureScore: 80 },   // Vieques
  SDU: { businessScore: 60, leisureScore: 50 },   // Santos Dumont (downtown Rio)

  // ── Expansion: UN member coverage ────────────────────────────────────────────
  BJM: { businessScore: 30, leisureScore: 35 },   // Bujumbura
  HAH: { businessScore: 25, leisureScore: 45 },   // Moroni
  DOM: { businessScore: 20, leisureScore: 70 },   // Dominica
  SSG: { businessScore: 40, leisureScore: 35 },   // Malabo
  SHO: { businessScore: 28, leisureScore: 40 },   // Eswatini
  CKY: { businessScore: 35, leisureScore: 35 },   // Conakry
  PAP: { businessScore: 32, leisureScore: 35 },   // Port-au-Prince
  FNJ: { businessScore: 30, leisureScore: 30 },   // Pyongyang
  MSU: { businessScore: 28, leisureScore: 38 },   // Maseru
  ROB: { businessScore: 32, leisureScore: 35 },   // Monrovia
  MLE: { businessScore: 30, leisureScore: 85 },   // Male / Maldives
  MAJ: { businessScore: 25, leisureScore: 45 },   // Majuro
  PNI: { businessScore: 25, leisureScore: 45 },   // Pohnpei
  ULN: { businessScore: 45, leisureScore: 45 },   // Ulaanbaatar
  ROR: { businessScore: 25, leisureScore: 55 },   // Koror / Palau
  UVF: { businessScore: 25, leisureScore: 70 },   // Saint Lucia
  SVD: { businessScore: 25, leisureScore: 65 },   // St Vincent
  FNA: { businessScore: 32, leisureScore: 38 },   // Freetown
  JUB: { businessScore: 30, leisureScore: 30 },   // Juba
  DAM: { businessScore: 40, leisureScore: 35 },   // Damascus
  FUN: { businessScore: 20, leisureScore: 45 },   // Funafuti / Tuvalu
};

// ── Region mapping ────────────────────────────────────────────────────────────
// Maps ISO country codes to display region names.
export const COUNTRY_REGION = {
  // North America (includes Central America & Caribbean)
  US: 'North America', CA: 'North America', MX: 'North America',
  PA: 'North America', CU: 'North America', DO: 'North America',
  JM: 'North America', BS: 'North America', BB: 'North America',
  SX: 'North America', TT: 'North America', KY: 'North America',
  BM: 'North America', SV: 'North America', GT: 'North America',
  HN: 'North America', NI: 'North America', CR: 'North America',
  PR: 'North America',
  // South America
  BR: 'South America', AR: 'South America', CL: 'South America',
  CO: 'South America', PE: 'South America', EC: 'South America',
  PY: 'South America', UY: 'South America', VE: 'South America',
  BO: 'South America', CW: 'South America', SR: 'South America',
  AW: 'South America',
  // Expansion: iconic territories + UN member coverage
  TL: 'Asia', BT: 'Asia', KP: 'Asia', MV: 'Asia', MN: 'Asia',
  FO: 'Europe', GI: 'Europe',
  GL: 'North America', PM: 'North America', BQ: 'North America', BL: 'North America',
  AI: 'North America', DM: 'North America', HT: 'North America', LC: 'North America',
  VC: 'North America',
  AS: 'Oceania', NR: 'Oceania', NF: 'Oceania', MH: 'Oceania', FM: 'Oceania',
  PW: 'Oceania', TV: 'Oceania',
  SH: 'Africa', BI: 'Africa', KM: 'Africa', GQ: 'Africa', SZ: 'Africa',
  GN: 'Africa', LS: 'Africa', LR: 'Africa', SL: 'Africa', SS: 'Africa',
  SY: 'Middle East',
  GY: 'South America',
  // Europe
  GB: 'Europe', FR: 'Europe', DE: 'Europe', NL: 'Europe',
  ES: 'Europe', IT: 'Europe', CH: 'Europe', AT: 'Europe',
  BE: 'Europe', PT: 'Europe', NO: 'Europe', SE: 'Europe',
  FI: 'Europe', DK: 'Europe', IE: 'Europe', PL: 'Europe',
  GR: 'Europe', TR: 'Europe', CZ: 'Europe', HU: 'Europe',
  RO: 'Europe', BG: 'Europe', HR: 'Europe', RS: 'Europe',
  SI: 'Europe', MK: 'Europe', AL: 'Europe', SK: 'Europe',
  UA: 'Europe', BY: 'Europe', EE: 'Europe', LV: 'Europe',
  LT: 'Europe', RU: 'Europe', IS: 'Europe',
  // Middle East & Central Asia
  AE: 'Middle East', QA: 'Middle East', SA: 'Middle East',
  IL: 'Middle East', KW: 'Middle East', BH: 'Middle East',
  OM: 'Middle East', LB: 'Middle East', JO: 'Middle East',
  IQ: 'Middle East', IR: 'Middle East', AZ: 'Middle East',
  GE: 'Middle East', AM: 'Middle East', UZ: 'Middle East',
  KZ: 'Middle East', KG: 'Middle East', TM: 'Middle East',
  TJ: 'Middle East', AF: 'Middle East', PK: 'Middle East',
  // Africa
  ZA: 'Africa', EG: 'Africa', KE: 'Africa', NG: 'Africa',
  MA: 'Africa', ET: 'Africa', DZ: 'Africa', TN: 'Africa',
  LY: 'Africa', SD: 'Africa', GH: 'Africa', CI: 'Africa',
  SN: 'Africa', ML: 'Africa', BF: 'Africa', NE: 'Africa',
  TD: 'Africa', TG: 'Africa', BJ: 'Africa', CD: 'Africa',
  CM: 'Africa', GA: 'Africa', CG: 'Africa', TZ: 'Africa',
  UG: 'Africa', RW: 'Africa', ZW: 'Africa', MW: 'Africa',
  MZ: 'Africa', NA: 'Africa', BW: 'Africa', MG: 'Africa',
  MU: 'Africa', ZM: 'Africa',
  // Asia (South, Southeast, East)
  SG: 'Asia', HK: 'Asia', MY: 'Asia', TH: 'Asia',
  ID: 'Asia', PH: 'Asia', IN: 'Asia', LK: 'Asia',
  BD: 'Asia', MM: 'Asia', VN: 'Asia', NP: 'Asia',
  JP: 'Asia', KR: 'Asia', CN: 'Asia', TW: 'Asia',
  KH: 'Asia', LA: 'Asia', BN: 'Asia', MO: 'Asia',
  // Oceania
  AU: 'Oceania', NZ: 'Oceania', PF: 'Oceania', NC: 'Oceania',
  FJ: 'Oceania', PG: 'Oceania', SB: 'Oceania', VU: 'Oceania',
  GU: 'Oceania', CK: 'Oceania', WS: 'Oceania', TO: 'Oceania', KI: 'Oceania',
  // Additional Europe
  JE: 'Europe', CY: 'Europe', LU: 'Europe', MT: 'Europe',
  ME: 'Europe', BA: 'Europe', XK: 'Europe', MD: 'Europe', IM: 'Europe',
  // Additional North America (Caribbean / Central America)
  BZ: 'North America', AG: 'North America', GD: 'North America', KN: 'North America',
  // Additional Africa
  ER: 'Africa', CF: 'Africa', GM: 'Africa', SO: 'Africa', DJ: 'Africa',
  AO: 'Africa', MR: 'Africa', GW: 'Africa', RE: 'Africa', SC: 'Africa',
  CV: 'Africa', ST: 'Africa',
  // Additional Middle East
  YE: 'Middle East',
};

export const REGIONS = [
  'North America', 'South America', 'Europe', 'Middle East', 'Africa', 'Asia', 'Oceania',
];

export function getRegion(country) {
  return COUNTRY_REGION[country] ?? 'Other';
}

/**
 * Return {businessScore, leisureScore} for an airport.
 * Looks up AIRPORT_SCORES first; falls back to tier-based defaults.
 *
 * @param {string} code  IATA airport code
 * @returns {{ businessScore: number, leisureScore: number }}
 */
export function getAirportScores(code) {
  if (AIRPORT_SCORES[code]) return AIRPORT_SCORES[code];

  const ap = getAirport(code);
  // Tier-based fallbacks: mega hubs are more business-oriented than tiny regionals
  const defaults = {
    mega:     { businessScore: 65, leisureScore: 55 },
    major:    { businessScore: 50, leisureScore: 52 },
    regional: { businessScore: 32, leisureScore: 55 },
  };
  return defaults[ap?.tier] ?? { businessScore: 40, leisureScore: 55 };
}

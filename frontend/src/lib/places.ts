export interface Place {
  label: string;
  name: string;
  detail: string;
  aliases?: string[];
}

// Well-known destinations, roughly most-planned first, so suggestions appear instantly and without a network call.
// One per line: name | region, country | other names people type
const RAW = `
Goa|India|Panaji;Panjim
Jaipur|Rajasthan, India|Pink City
Udaipur|Rajasthan, India
Tokyo|Japan
Paris|France
Dubai|United Arab Emirates
Singapore||
Bali|Indonesia
Delhi|India|New Delhi
Mumbai|Maharashtra, India|Bombay
Manali|Himachal Pradesh, India
Kerala|India
Agra|Uttar Pradesh, India|Taj Mahal
Bangkok|Thailand
London|United Kingdom
Phuket|Thailand
Maldives||
Shimla|Himachal Pradesh, India
Rishikesh|Uttarakhand, India
Leh|Ladakh, India
Ladakh|India
Srinagar|Jammu and Kashmir, India|Kashmir
Varanasi|Uttar Pradesh, India|Banaras;Benares;Kashi
Darjeeling|West Bengal, India
Munnar|Kerala, India
Kochi|Kerala, India|Cochin
Alleppey|Kerala, India|Alappuzha
Ooty|Tamil Nadu, India|Udhagamandalam
Coorg|Karnataka, India|Kodagu;Madikeri
Mysuru|Karnataka, India|Mysore
Hampi|Karnataka, India
Puducherry|India|Pondicherry
Jodhpur|Rajasthan, India
Jaisalmer|Rajasthan, India
Amritsar|Punjab, India
Kolkata|West Bengal, India|Calcutta
Bengaluru|Karnataka, India|Bangalore
Chennai|Tamil Nadu, India|Madras
Hyderabad|Telangana, India
Pune|Maharashtra, India|Poona
Ahmedabad|Gujarat, India
Kuala Lumpur|Malaysia|KL
Hong Kong||
Seoul|South Korea
Kyoto|Japan
Osaka|Japan
Rome|Italy|Roma
Venice|Italy|Venezia
Florence|Italy|Firenze
Milan|Italy|Milano
Barcelona|Spain
Madrid|Spain
Amsterdam|Netherlands
Prague|Czechia|Praha
Vienna|Austria|Wien
Zurich|Switzerland|Zürich
Interlaken|Switzerland
Lucerne|Switzerland|Luzern
Geneva|Switzerland|Genève
Istanbul|Türkiye|Turkey
New York|New York, United States|NYC;New York City
Abu Dhabi|United Arab Emirates
Doha|Qatar
Kathmandu|Nepal
Pokhara|Nepal
Thimphu|Bhutan
Paro|Bhutan
Colombo|Sri Lanka
Kandy|Sri Lanka
Ella|Sri Lanka
Hanoi|Vietnam
Ho Chi Minh City|Vietnam|Saigon
Da Nang|Vietnam
Hoi An|Vietnam
Siem Reap|Cambodia|Angkor Wat
Krabi|Thailand
Chiang Mai|Thailand
Pattaya|Thailand
Koh Samui|Thailand|Ko Samui
Langkawi|Malaysia
Penang|Malaysia|George Town
Mauritius||
Seychelles||
Gangtok|Sikkim, India
Shillong|Meghalaya, India
Dharamshala|Himachal Pradesh, India|Dharamsala;McLeod Ganj
Kasol|Himachal Pradesh, India
Spiti Valley|Himachal Pradesh, India|Spiti
Mussoorie|Uttarakhand, India
Nainital|Uttarakhand, India
Haridwar|Uttarakhand, India
Auli|Uttarakhand, India
Gulmarg|Jammu and Kashmir, India
Pahalgam|Jammu and Kashmir, India
Andaman Islands|India|Andaman and Nicobar;Havelock;Port Blair
Lakshadweep|India
Pushkar|Rajasthan, India
Mount Abu|Rajasthan, India
Ranthambore|Rajasthan, India|Sawai Madhopur
Khajuraho|Madhya Pradesh, India
Bhopal|Madhya Pradesh, India
Indore|Madhya Pradesh, India
Ujjain|Madhya Pradesh, India
Lucknow|Uttar Pradesh, India
Puri|Odisha, India
Bhubaneswar|Odisha, India
Gokarna|Karnataka, India
Chikmagalur|Karnataka, India|Chikkamagaluru
Wayanad|Kerala, India
Varkala|Kerala, India
Thiruvananthapuram|Kerala, India|Trivandrum
Kovalam|Kerala, India
Madurai|Tamil Nadu, India
Kodaikanal|Tamil Nadu, India
Mahabalipuram|Tamil Nadu, India|Mamallapuram
Kanyakumari|Tamil Nadu, India
Lonavala|Maharashtra, India
Mahabaleshwar|Maharashtra, India
Nashik|Maharashtra, India
Visakhapatnam|Andhra Pradesh, India|Vizag
Tirupati|Andhra Pradesh, India
Chandigarh|India
Guwahati|Assam, India
Kaziranga|Assam, India
Dwarka|Gujarat, India
Rann of Kutch|Gujarat, India|Kutch;Bhuj
Edinburgh|United Kingdom
Dublin|Ireland
Berlin|Germany
Munich|Germany|München
Frankfurt|Germany
Brussels|Belgium
Budapest|Hungary
Krakow|Poland|Kraków
Copenhagen|Denmark
Stockholm|Sweden
Oslo|Norway
Helsinki|Finland
Reykjavik|Iceland|Reykjavík
Lisbon|Portugal|Lisboa
Porto|Portugal
Seville|Spain|Sevilla
Nice|France
Santorini|Greece|Thira
Athens|Greece
Mykonos|Greece
Dubrovnik|Croatia
Salzburg|Austria
Amalfi Coast|Italy|Amalfi;Positano
Antalya|Türkiye
Cappadocia|Türkiye|Göreme
Cairo|Egypt
Muscat|Oman
Baku|Azerbaijan
Tbilisi|Georgia
Almaty|Kazakhstan
Cape Town|South Africa
Marrakesh|Morocco|Marrakech
Nairobi|Kenya
Zanzibar|Tanzania
Los Angeles|California, United States|LA
San Francisco|California, United States|SF
Las Vegas|Nevada, United States
Chicago|Illinois, United States
Miami|Florida, United States
Orlando|Florida, United States
Washington|District of Columbia, United States|Washington DC;DC
Boston|Massachusetts, United States
Honolulu|Hawaii, United States|Hawaii
Toronto|Ontario, Canada
Vancouver|British Columbia, Canada
Montreal|Quebec, Canada|Montréal
Banff|Alberta, Canada
Mexico City|Mexico|CDMX
Cancún|Mexico|Cancun
Rio de Janeiro|Brazil|Rio
Buenos Aires|Argentina
Lima|Peru
Cusco|Peru|Cuzco;Machu Picchu
Sydney|New South Wales, Australia
Melbourne|Victoria, Australia
Gold Coast|Queensland, Australia
Cairns|Queensland, Australia
Perth|Western Australia, Australia
Auckland|New Zealand
Queenstown|New Zealand
Fiji||
Taipei|Taiwan
Shanghai|China
Beijing|China
Manila|Philippines
Cebu|Philippines
Boracay|Philippines
Jakarta|Indonesia
Yogyakarta|Indonesia|Jogja
Dhaka|Bangladesh
`;

export const PLACES: Place[] = RAW.trim()
  .split("\n")
  .map((line) => {
    const [name, detail = "", aliases = ""] = line.split("|");
    return { name, detail, label: detail ? `${name}, ${detail}` : name, aliases: aliases ? aliases.split(";") : undefined };
  });

const byName = new Map(PLACES.map((p) => [p.name, p]));
/** Shown before anything is typed. */
export const POPULAR: Place[] = ["Jaipur", "Goa", "Udaipur", "Tokyo", "Paris", "Dubai", "Singapore", "Bali"].map((n) => byName.get(n)!);

/** Lower case without accents, so "cancun" finds Cancún and "zurich" matches "Zürich". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Matches ranked the way people type: name prefix, then another name for the place, then any word, then anywhere
 * (from three letters).
 * Ties keep list order, which is roughly how often each place is planned ("pa" is Paris before Paro). */
export function rankPlaces<T extends Place>(list: T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return list;
  const score = (p: T) => {
    const name = fold(p.name);
    if (name.startsWith(q)) return 0;
    if (p.aliases?.some((a) => fold(a).startsWith(q))) return 1;
    const label = fold(p.label);
    if (label.split(/[\s,]+/).some((w) => w.startsWith(q))) return 2;
    if (q.length < 3) return -1; // mid-word matches on two letters are noise ("go" is not Chicago)
    if (name.includes(q)) return 3;
    return label.includes(q) ? 4 : -1;
  };
  return list
    .map((p) => ({ p, k: score(p) }))
    .filter((x) => x.k >= 0)
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
}

const COUNTRY_ALIASES: Record<string, string> = { usa: "united states", us: "united states", uk: "united kingdom", uae: "united arab emirates", turkey: "turkiye" };
/** The same place from two sources ("New York, NY, USA" and "New York, New York, United States") gets one key. */
export function placeKey(p: Place): string {
  const country = fold(p.label.split(",").pop() ?? "").trim();
  return `${fold(p.name)}|${COUNTRY_ALIASES[country] ?? country}`;
}

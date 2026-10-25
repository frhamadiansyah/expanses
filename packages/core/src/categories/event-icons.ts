/**
 * The icon a shared event's category wears when nobody chose one. A shared event is usually a trip taken together, so the
 * icons are the built-in Travel set's (Flights, Hotels, Activities, Transport, Souvenirs, Meals, Others — see `visuals.ts`),
 * picked by the words in the category's name. A name that matches nothing is Travel's "Others". Pure; the keys are icon
 * registry keys, never a component.
 */
const RULES: readonly [RegExp, string][] = [
  [/\b(flights?|fly|plane|airfare|airline|airport)\b/, 'plane'],
  [/\b(stay|stays|hotels?|hostels?|lodging|accommodation|villa|villas|airbnb|rent|rental|cabin|house|room|rooms|resort)\b/, 'bed'],
  [/\b(boats?|ferry|ferries|ship|sailing|cruise|canoe|kayak)\b/, 'ship'],
  [/\b(transport|transit|taxi|taxis|cab|ride|rides|car|cars|bus|buses|train|trains|metro|fuel|petrol|gas|parking|toll|tolls|bike|bikes|scooter|scooters|tuk)\b/, 'train-front'],
  [/\b(food|foods|meal|meals|eat|eating|dinner|lunch|breakfast|brunch|restaurants?|cafe|coffee|drinks?|groceries|snacks?|bar|market)\b/, 'utensils'],
  [/\b(souvenirs?|gifts?|shopping|shop|presents?)\b/, 'shopping-bag'],
  [/\b(activit(y|ies)|tours?|tickets?|entry|entrance|fun|sights?|sightseeing|museum|park|show|shows|trek|trekking|hike|hiking|excursions?)\b/, 'map-pin'],
];

export function eventCategoryIcon(name: string): string {
  const words = name.toLowerCase();
  for (const [pattern, icon] of RULES) if (pattern.test(words)) return icon;
  return 'luggage';
}

/**
 * How a category looks: one colour per top-level category, one icon per category.
 *
 * Icons are names, not images, so this stays plain data; the app maps each name to a drawing it ships
 * with, and any name it does not know falls back to a neutral mark. A category the owner created has
 * no entry here and borrows its parent's look.
 */
export const CATEGORY_COLOURS: Readonly<Record<string, string>> = {
  utilities: '#0891b2',
  household: '#16a34a',
  food_beverage: '#ea580c',
  transportation: '#2563eb',
  property: '#a16207',
  health_care: '#dc2626',
  protection: '#0f766e',
  education: '#4f46e5',
  personal_care: '#c026d3',
  entertainment: '#7c3aed',
  shopping: '#db2777',
  donation: '#0d9488',
  gift_giving: '#e11d48',
  government_taxes: '#475569',
  miscellaneous: '#64748b',
  travel: '#0284c7',
  business: '#334155',
  income: '#059669',
};

export const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  utilities: 'zap', 'utilities.electricity': 'zap', 'utilities.internet_provider': 'wifi', 'utilities.mobile_phone': 'smartphone',
  'utilities.water_sanitation': 'droplets', 'utilities.sewer_waste': 'trash-2', 'utilities.gas_energy': 'flame',
  household: 'house', 'household.groceries': 'shopping-basket', 'household.supplies': 'spray-can',
  food_beverage: 'utensils', 'food_beverage.takeaways': 'package', 'food_beverage.restaurants': 'utensils-crossed',
  'food_beverage.cafe_dessert': 'coffee', 'food_beverage.home_catering': 'chef-hat', 'food_beverage.school_catering': 'sandwich',
  transportation: 'car', 'transportation.vehicle_maintenance': 'wrench', 'transportation.fuel_cost': 'fuel',
  'transportation.parking_tolls': 'circle-parking', 'transportation.ride_hailing': 'car-taxi-front', 'transportation.public_transport': 'bus',
  'transportation.auto_repair': 'hammer',
  property: 'building-2', 'property.housing_rent': 'key-round', 'property.house_maintenance': 'paint-roller', 'property.community_security': 'shield',
  'property.home_services': 'hand-helping', 'property.decor_furnishings': 'sofa', 'property.repair_improvements': 'hammer', 'property.real_estate': 'building',
  health_care: 'heart-pulse', 'health_care.supplements': 'pill', 'health_care.outpatient_care': 'stethoscope', 'health_care.pharmacy': 'pill-bottle',
  'health_care.vision_dental_care': 'eye', 'health_care.accident_emergency': 'siren', 'health_care.general_check_up': 'clipboard-plus',
  protection: 'shield-check', 'protection.health_insurance': 'shield-plus', 'protection.life_insurance': 'heart-handshake',
  'protection.critical_insurance': 'shield-alert', 'protection.auto_insurance': 'car',
  education: 'graduation-cap', 'education.administration': 'file-text', 'education.tuition_fees': 'school', 'education.parent_association': 'users',
  'education.after_school_club': 'palette', 'education.field_trip_activities': 'map', 'education.performances': 'drama', 'education.shuttle_bus': 'bus-front',
  'education.text_books_supplies': 'book-open', 'education.courses_lessons': 'presentation', 'education.pocket_money': 'wallet',
  personal_care: 'sparkles', 'personal_care.self_development': 'brain', 'personal_care.grooming_haircuts': 'scissors', 'personal_care.sports_fitness': 'dumbbell',
  'personal_care.spa_wellness': 'flower-2', 'personal_care.dry_clean_laundry': 'shirt', 'personal_care.counselling_therapy': 'message-circle-heart',
  entertainment: 'clapperboard', 'entertainment.subscriptions': 'repeat', 'entertainment.movies': 'film', 'entertainment.recreation': 'tent',
  'entertainment.games': 'gamepad-2', 'entertainment.concert_events': 'ticket', 'entertainment.craft_hobbies': 'brush',
  shopping: 'shopping-bag', 'shopping.clothing': 'shirt', 'shopping.electronics': 'laptop', 'shopping.toys': 'blocks', 'shopping.books': 'book',
  donation: 'hand-heart', 'donation.obligation': 'hand-coins', 'donation.dependant': 'users-round', 'donation.charity': 'hand-heart',
  gift_giving: 'gift', 'gift_giving.birthday': 'cake', 'gift_giving.relatives': 'users', 'gift_giving.wedding': 'gem', 'gift_giving.newborn': 'baby',
  'gift_giving.funeral': 'flower', 'gift_giving.celebration': 'party-popper',
  government_taxes: 'landmark', 'government_taxes.estimated_tax': 'receipt', 'government_taxes.land_building_tax': 'building',
  'government_taxes.motor_vehicle_tax': 'car',
  miscellaneous: 'circle-ellipsis', 'miscellaneous.postal_service': 'mail', 'miscellaneous.professional_fee': 'briefcase',
  'miscellaneous.fine_penalty': 'gavel', 'miscellaneous.documentation': 'file-check', 'miscellaneous.interest': 'percent',
  'miscellaneous.fees_charges': 'badge-percent', 'miscellaneous.membership_fee': 'id-card',
  travel: 'plane', 'travel.flights': 'plane', 'travel.hotels': 'bed', 'travel.activities': 'map-pin',
  business: 'briefcase',
  'income.salary': 'banknote', 'income.bonus': 'trophy', 'income.investment': 'trending-up', 'income.realized_gains': 'chart-line',
  'income.cashback': 'badge-percent', 'income.gifts': 'gift', 'income.other': 'circle-plus',
};

export const TRANSFER_VISUAL = { icon: 'arrow-left-right', colour: '#475569' } as const;
export const UNKNOWN_VISUAL = { icon: 'circle-help', colour: '#64748b' } as const;

/**
 * The look of a category from its own key and its top-level parent's key.
 *
 * Income categories all share the income colour. A category without an icon of its own takes its
 * parent's, so one the owner added under Household still reads as Household.
 */
export function categoryVisual(key: string | null, rootKey: string | null): { icon: string; colour: string } {
  const root = rootKey ?? key;
  const colour = (root && (root.startsWith('income') ? CATEGORY_COLOURS.income : CATEGORY_COLOURS[root])) ?? UNKNOWN_VISUAL.colour;
  const icon = (key && CATEGORY_ICONS[key]) ?? (root && CATEGORY_ICONS[root]) ?? UNKNOWN_VISUAL.icon;
  return { icon, colour };
}

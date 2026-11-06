// Public business contact supplied by the owner; can be overridden per deployment.
export const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '+233549329735';

export const businessEnquiry = message => `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

/**
 * What the website showed before site content moved to the database. Used
 *   - by `npm run content:seed` to fill the database the first time
 *     (`file` = image in kreedum_frontend/public/images), and
 *   - by the API for anything not seeded yet, so the site never goes blank.
 */
module.exports = {
  heroBanners: [
    {
      title: "Aerofit Premium Gym Equipment",
      subtitle: "Official Aerofit Channel Partner in Lucknow",
      buttonText: "Shop Aerofit",
      buttonLink: "/brands/aerofit",
      file: "home-hero/aerofit-gym.jpg",
    },
    {
      title: "Complete Home Gym Setup",
      subtitle: "Build your dream gym at home with Kreedum Sports.",
      buttonText: "Explore Home Gym",
      buttonLink: "/categories/home-gym",
      file: "home-hero/home-gym-setup.jpg",
    },
    {
      title: "Sports Flooring & Court Solutions",
      subtitle: "Badminton • Basketball • Pickleball • Football Turf",
      buttonText: "Explore Sports Infrastructure",
      buttonLink: "/categories/flooring",
      file: "home-hero/sports-courts.jpg",
    },
  ],

  announcements: [
    { text: "Welcome to Kreedum Sports" },
    { text: "Quality Sports & Fitness Equipment" },
    { text: "Explore Our Latest Products" },
  ],

  leaders: [
    {
      name: "Richa Kothari",
      role: "Managing Director",
      quote:
        "Our vision is to make quality sports and fitness equipment accessible, helping more people pursue their goals with confidence.",
      file: "richa-kothari.jpeg",
    },
    {
      name: "Shivam Gupta",
      role: "CEO",
      quote:
        "We believe every sporting ambition deserves the right support. Our focus is on building a dependable experience for every customer we serve.",
      file: "shivam-gupta.jpeg",
    },
  ],

  clients: [
    { name: "CMS", file: "client-logo/CMS-Logo.png" },
    { name: "Chandigarh University", file: "client-logo/CU-logo.png" },
    { name: "HAL", file: "client-logo/HAL-logo.png" },
    { name: "IET", file: "client-logo/IET-logo.png" },
    { name: "IIT Kanpur", file: "client-logo/IIT KANPUR.png" },
    { name: "Indian Railways", file: "client-logo/Indian-railway-logo.png" },
    { name: "Integral University", file: "client-logo/Integral_University,_Lucknow-logo.png" },
    { name: "JNV", file: "client-logo/JNV-logo.png" },
    { name: "Lucknow University", file: "client-logo/LU-logo.png" },
    { name: "Lucknow Development Authority", file: "client-logo/Lucknow_Development_Authority-logo.png" },
    { name: "Power Grid", file: "client-logo/PoerGrid-logo.png" },
    { name: "RGPIT", file: "client-logo/RGPIT-logo.png" },
    { name: "IIM Lucknow", file: "client-logo/iim-lucknow-logo.png" },
    { name: "Indian Army", file: "client-logo/indian-army-logo.png" },
    { name: "SSB", file: "client-logo/ssb-logo.jpg" },
    { name: "UP Police", file: "client-logo/up-police-logo.jpg" },
  ],
};

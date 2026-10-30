# Kreedum Sports — Ecommerce Backend

The official REST API backend for the **Kreedum Sports Ecommerce Platform**. Built with Node.js, Express and MongoDB, it powers the product catalogue, search, customer accounts, shopping cart, wishlist, addresses, checkout and order management.

**Repository:** [kreedum_backend](https://github.com/kreedum-web/kreedum_backend)

---

## Overview

Kreedum Backend provides the server-side infrastructure for the Kreedum Sports ecommerce platform.

It handles product and category data, customer authentication, shopping operations, address management and order processing through a modular REST API architecture.

### Key Features

- **Product Catalogue:** Product listings, product details, pagination, filtering and sorting.
- **Category Management:** Hierarchical category tree, category details and category-based products.
- **Brand Management:** Brand listings, brand details and brand-specific products.
- **Search:** Global product search, autocomplete suggestions and popular searches.
- **Homepage APIs:** Aggregated homepage content, featured products, deals and statistics.
- **Authentication:** Customer registration, login, JWT-based authentication and profile management.
- **Customer Profile:** Personal information, birthday management, password updates and dashboard summary.
- **Wishlist:** Add, remove, retrieve and check wishlist products.
- **Shopping Cart:** Add products, update quantities, remove items and clear the cart.
- **Product Variants:** Cart support for products with selectable options using variant IDs.
- **Address Management:** Indian pincode lookup and customer saved-address management.
- **Order Management:** Order placement, order history, order details, cancellation and tracking timeline.
- **Database Migrations:** Category, product and brand migrations, index creation, product enrichment and catalogue rebuilding.
- **API Documentation:** Interactive Swagger UI documentation.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express 5 | REST API framework |
| MongoDB | NoSQL database |
| Mongoose | MongoDB object modelling |
| JWT | Authentication |
| bcryptjs | Password hashing |
| Axios | HTTP requests |
| Helmet | HTTP security headers |
| CORS | Cross-origin resource sharing |
| Compression | Response compression |
| Morgan | HTTP request logging |
| Swagger | API documentation |
| Nodemon | Development server |

---

## Architecture

The backend follows a modular, layered architecture.

```text
Client Application
       |
       v
  Express Server
       |
       v
  Global Middleware
       |
       v
     Routes
       |
       v
   Controllers
       |
       v
    Services
       |
       v
    Mongoose
       |
       v
    MongoDB
```

### Architecture Responsibilities

| Layer | Responsibility |
|---|---|
| Routes | Define API endpoints and middleware |
| Controllers | Handle HTTP requests and responses |
| Services | Implement application and business logic |
| Models | Define MongoDB schemas and data structures |
| Middleware | Handle authentication and shared request processing |
| Config | Database, application and Swagger configuration |
| Migration | Database migrations and catalogue maintenance |
| Utils | Shared utilities and database initialization |

---

## Project Structure

```text
kreedum_backend/
│
├── server.js
│
├── src/
│   │
│   ├── app.js
│   │
│   ├── config/
│   │   ├── bootstrap.js
│   │   ├── database.js
│   │   └── swagger.js
│   │
│   ├── controllers/
│   │   ├── addressController.js
│   │   ├── authController.js
│   │   ├── brandController.js
│   │   ├── cartController.js
│   │   ├── categoryController.js
│   │   ├── homepageController.js
│   │   ├── orderController.js
│   │   ├── productController.js
│   │   ├── profileController.js
│   │   ├── savedAddressController.js
│   │   ├── searchController.js
│   │   └── wishlistController.js
│   │
│   ├── middleware/
│   │   ├── asyncHandler.js
│   │   └── authMiddleware.js
│   │
│   ├── models/
│   │   ├── Address.js
│   │   ├── Brand.js
│   │   ├── Cart.js
│   │   ├── Category.js
│   │   ├── Enquiry.js
│   │   ├── Order.js
│   │   ├── Product.js
│   │   ├── SupplierCategory.js
│   │   ├── SupplierProduct.js
│   │   ├── User.js
│   │   └── Wishlist.js
│   │
│   ├── routes/
│   │   ├── addressRoutes.js
│   │   ├── authRoutes.js
│   │   ├── brandRoutes.js
│   │   ├── cartRoutes.js
│   │   ├── categoryRoutes.js
│   │   ├── homepageRoutes.js
│   │   ├── orderRoutes.js
│   │   ├── productRoutes.js
│   │   ├── profileRoutes.js
│   │   ├── savedAddressRoutes.js
│   │   ├── searchRoutes.js
│   │   └── wishlistRoutes.js
│   │
│   ├── services/
│   │   ├── addressService.js
│   │   ├── authService.js
│   │   ├── brandService.js
│   │   ├── cartService.js
│   │   ├── categoryService.js
│   │   ├── homepageService.js
│   │   ├── orderService.js
│   │   ├── productService.js
│   │   ├── profileService.js
│   │   ├── savedAddressService.js
│   │   ├── searchService.js
│   │   └── wishlistService.js
│   │
│   ├── migration/
│   │   ├── categoryMap.js
│   │   ├── categoryMapping.js
│   │   ├── createIndexes.js
│   │   ├── enrichProducts.js
│   │   ├── migrateBrands.js
│   │   ├── migrateCategories.js
│   │   ├── migrateProducts.js
│   │   ├── normalizeBrands.js
│   │   └── rebuildCatalog.js
│   │
│   └── utils/
│       ├── ensureCartIndexes.js
│       └── jwt.js
│
├── package.json
├── package-lock.json
└── README.md
```

---

## Getting Started

### Prerequisites

Make sure the following are installed:

- Node.js (LTS recommended)
- npm
- MongoDB Atlas account or a local MongoDB instance
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/kreedum-web/kreedum_backend.git
```

```bash
cd kreedum_backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root.

```env
PORT=5000

MONGODB_URI=your_mongodb_connection_string

JWT_SECRET=your_secure_jwt_secret
```

| Variable | Description |
|---|---|
| `PORT` | Server port. Defaults to `5000`. |
| `MONGODB_URI` | MongoDB connection string. |
| `JWT_SECRET` | Secret used to sign and verify JWT tokens. |

**Important:** Never commit your `.env` file or expose database credentials and JWT secrets in source control.

### 4. Start the Development Server

```bash
npm run dev
```

For production:

```bash
npm start
```

The API will run at:

```text
http://localhost:5000
```

---

## API Documentation

Interactive API documentation is available through Swagger UI.

**Local URL:**

```text
http://localhost:5000/api/docs
```

Swagger provides endpoint descriptions, query parameters, request bodies, response definitions and JWT authorization support.

---

## API Reference

All application endpoints use the `/api/v1` prefix.

### 1. Products

Base URL: `/api/v1/products`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get paginated products |
| GET | `/:slug` | Get product details by slug |

Supported product listing parameters include:

- `page`, `limit`
- `department`
- `parentCategory`, `childCategory`
- `brand`
- `minPrice`, `maxPrice`
- `sort`
- `featured`, `bestSeller`, `newArrival`, `trending`
- `stockStatus`

### 2. Categories

Base URL: `/api/v1/categories`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get complete category tree |
| GET | `/:slug` | Get category details |
| GET | `/:slug/products` | Get products within a category |

### 3. Brands

Base URL: `/api/v1/brands`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get all brands |
| GET | `/:slug` | Get brand details |
| GET | `/:slug/products` | Get products by brand |

### 4. Search

Base URL: `/api/v1/search`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Search products |
| GET | `/suggestions` | Get autocomplete suggestions |
| GET | `/popular` | Get popular searches |

Example:

```http
GET /api/v1/search?q=treadmill&page=1&limit=12
```

### 5. Homepage

Base URL: `/api/v1/homepage`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get complete homepage data |
| GET | `/stats` | Get homepage statistics |
| GET | `/deals` | Get discounted products |
| GET | `/featured` | Get featured products |

### 6. Authentication

Base URL: `/api/v1/auth`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/register` | Register a customer |
| POST | `/login` | Login a customer |
| GET | `/me` | Get logged-in customer |
| PUT | `/profile` | Update customer profile |

Customer profile data supports:

- First name
- Last name
- Phone number
- Birthday (`YYYY-MM-DD`)

### 7. Customer Profile

Base URL: `/api/v1/profile`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get customer profile |
| PATCH | `/` | Update customer profile |
| PATCH | `/password` | Change password |
| GET | `/dashboard` | Get customer dashboard summary |

### 8. Wishlist

Base URL: `/api/v1/wishlist`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get customer wishlist |
| POST | `/:productId` | Add product to wishlist |
| DELETE | `/:productId` | Remove product from wishlist |
| GET | `/check/:productId` | Check wishlist status |

### 9. Shopping Cart

Base URL: `/api/v1/cart`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get customer cart |
| POST | `/:productId` | Add product to cart |
| PATCH | `/:productId` | Update product quantity |
| DELETE | `/:productId` | Remove product from cart |
| DELETE | `/` | Clear cart |

Cart operations support product variants through `variantId`, allowing different options of the same product to be maintained as separate cart lines.

Example request:

```json
{
  "quantity": 2,
  "variantId": "7027"
}
```

### 10. Address Lookup

Base URL: `/api/v1/address`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/pincode/:pincode` | Get address information using an Indian pincode |

Example:

```http
GET /api/v1/address/pincode/226010
```

### 11. Saved Addresses

Base URL: `/api/v1/addresses`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/` | Create a saved address |
| GET | `/` | Get all saved addresses |
| GET | `/:id` | Get address by ID |
| PATCH | `/:id` | Update address |
| PATCH | `/:id/default` | Set default address |
| DELETE | `/:id` | Delete address |

### 12. Orders

Base URL: `/api/v1/orders`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/` | Place an order |
| GET | `/` | Get customer orders |
| GET | `/:orderId` | Get order details |
| PATCH | `/:orderId/cancel` | Cancel an order |
| GET | `/:orderId/tracking` | Get order tracking timeline |

Order placement uses the authenticated customer's cart and a shipping address supplied in the request.

---

## Authentication

The API uses JSON Web Tokens (JWT) to protect customer-specific endpoints.

### Authentication Flow

1. Customer registers or logs in.
2. Backend validates credentials.
3. Passwords are stored using bcrypt hashing.
4. Backend generates a JWT.
5. Client stores the token securely.
6. Client sends the token with protected API requests.

### Authorization Header

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Protected routes use the authentication middleware to validate the token and retrieve the associated customer.

---

## Database

The application uses MongoDB with Mongoose.

The database connection is configured through:

```text
src/config/database.js
```

The database name is:

```text
KreedumCommerce
```

### Main Collections / Models

| Model | Purpose |
|---|---|
| Product | Product catalogue |
| Category | Ecommerce category hierarchy |
| Brand | Product brands |
| User | Customer accounts |
| Cart | Customer shopping carts |
| Wishlist | Customer wishlists |
| Address | Customer address records |
| Order | Customer orders |
| SupplierProduct | Supplier product data |
| SupplierCategory | Supplier category data |
| Enquiry | Product enquiry records |

### Database Initialization

During server startup, the application:

1. Loads environment configuration.
2. Connects to MongoDB.
3. Checks and updates cart indexes.
4. Starts the Express server.

The cart index initialization handles the older unique cart index and supports separate cart lines for products with different variants.

---

## Database Migration Commands

The project includes scripts for maintaining and rebuilding catalogue data.

Run these commands from the project root.

| Command | Purpose |
|---|---|
| `npm run migrate:categories` | Migrate category data |
| `npm run migrate:products` | Migrate product data |
| `npm run migrate:brands` | Migrate brand data |
| `npm run migrate:indexes` | Create database indexes |
| `npm run migrate:normalize-brands` | Normalize brand records |
| `npm run migrate:enrich-products` | Enrich product records |
| `npm run rebuild:catalog` | Rebuild the catalogue |

Example:

```bash
npm run migrate:categories
```

```bash
npm run migrate:brands
```

```bash
npm run rebuild:catalog
```

**Migration safety:** These commands can modify database records and indexes. Review the relevant migration implementation and take a database backup before running them against production data. Run them only when the intended data operation is understood.

---

## Health Check

The API exposes a health-check endpoint.

```http
GET /health
```

Example response:

```json
{
  "success": true,
  "service": "Kreedum API",
  "version": "8.1.0",
  "status": "running"
}
```

---

## Error Handling

The application includes:

- Centralized error handling.
- A JSON response for unknown routes.
- JWT authentication error responses.
- HTTP request logging through Morgan.

Unknown routes return:

```json
{
  "success": false,
  "message": "API route not found."
}
```

---

## Deployment

The backend can be deployed to a Node.js-compatible hosting platform.

### Production Configuration

Configure the following environment variables in the hosting provider:

```env
PORT=5000
MONGODB_URI=your_production_mongodb_uri
JWT_SECRET=your_production_jwt_secret
```

Use the hosting provider's assigned port when required. Do not hardcode production credentials in the repository.

### Production Checklist

- [ ] Configure production MongoDB connection.
- [ ] Set a secure JWT secret.
- [ ] Configure frontend CORS access appropriately.
- [ ] Verify database indexes.
- [ ] Test authentication and protected routes.
- [ ] Verify product, cart and checkout APIs.
- [ ] Verify order creation and retrieval.
- [ ] Check `/health`.
- [ ] Verify Swagger documentation.
- [ ] Review server logs and error responses.

---

## Related Repositories

| Repository | Description |
|---|---|
| [kreedum_frontend](https://github.com/kreedum-web/kreedum_frontend) | Kreedum Sports ecommerce frontend |
| [ms-scrapper-V2](https://github.com/kreedum-web/ms-scrapper-V2) | Metro Sports product scraping and catalogue synchronization |
| [kreedum-sports](https://github.com/kreedum-web/kreedum-sports) | Kreedum Sports website |

---

## Development

Start the development server:

```bash
npm run dev
```

Start the production server:

```bash
npm start
```

The project uses CommonJS modules and follows a modular Express architecture. Keep new features separated into routes, controllers, services and models wherever applicable.

---

## License

This repository is maintained for the Kreedum Sports platform.

---

**Kreedum Sports — Powering Sports & Fitness Ecommerce.**
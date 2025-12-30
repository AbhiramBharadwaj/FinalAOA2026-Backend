import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from './models/Admin.js';
import Accommodation from './models/Accommodation.js';
import User from './models/User.js';

dotenv.config();

const seedData = async () => {
  try {
    await mongoose.connect("mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority");
    console.log('Connected to MongoDB');

    // Clear existing data
    await Admin.deleteMany({});
    await Accommodation.deleteMany({});
    
    // Create admin user
    const admin = new Admin({
      name: 'AOA Admin',
      email: 'admin@aoa-shivamogga.org',
      password: 'admin123'
    });
    await admin.save();
    console.log('Admin user created');

    // Create accommodations
    const accommodations = [
      {
        name: 'Hotel Shivamogga Grand',
        description: 'Luxurious hotel in the heart of Shivamogga with modern amenities and excellent service. Perfect for conference attendees seeking comfort and convenience.',
        images: [
          'https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg',
          'https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg',
          'https://images.pexels.com/photos/237371/pexels-photo-237371.jpeg'
        ],
        pricePerNight: 3500,
        totalRooms: 50,
        availableRooms: 45,
        amenities: [
          'Free Wi-Fi',
          'Air Conditioning',
          'Swimming Pool',
          'Gym',
          'Restaurant',
          'Room Service',
          '24/7 Front Desk',
          'Parking',
          'Conference Rooms',
          'Laundry Service'
        ],
        inclusions: [
          'Complimentary breakfast',
          'Free Wi-Fi access',
          'Airport shuttle service',
          'Welcome drinks',
          'Daily housekeeping',
          'Access to fitness center',
          'Business center access',
          'Concierge services'
        ],
        exclusions: [
          'Meals (except breakfast)',
          'Personal expenses',
          'Telephone charges',
          'Mini-bar items',
          'Spa treatments',
          'Extra bed charges',
          'Tourism tax',
          'Travel insurance'
        ],
        faqs: [
          {
            question: 'What is the check-in and check-out time?',
            answer: 'Check-in is at 2:00 PM and check-out is at 12:00 PM.'
          },
          {
            question: 'Is parking available?',
            answer: 'Yes, complimentary parking is available for all guests.'
          },
          {
            question: 'Do you provide airport shuttle?',
            answer: 'Yes, we provide complimentary airport shuttle service.'
          },
          {
            question: 'Is there a cancellation policy?',
            answer: 'Free cancellation up to 24 hours before check-in.'
          },
          {
            question: 'Are pets allowed?',
            answer: 'Sorry, pets are not allowed in the hotel.'
          },
          {
            question: 'Do you have conference facilities?',
            answer: 'Yes, we have fully equipped conference rooms available.'
          },
          {
            question: 'Is room service available?',
            answer: 'Yes, 24/7 room service is available.'
          },
          {
            question: 'Do you offer laundry service?',
            answer: 'Yes, laundry and dry cleaning services are available.'
          }
        ],
        rating: 4.5,
        location: 'MG Road, Shivamogga',
        checkInTime: '14:00',
        checkOutTime: '12:00'
      },
      {
        name: 'Royal Inn Shivamogga',
        description: 'Premium business hotel offering exceptional hospitality and world-class facilities. Strategically located near major attractions and business centers.',
        images: [
          'https://images.pexels.com/photos/338504/pexels-photo-338504.jpeg',
          'https://images.pexels.com/photos/271639/pexels-photo-271639.jpeg',
          'https://images.pexels.com/photos/1134176/pexels-photo-1134176.jpeg'
        ],
        pricePerNight: 4200,
        totalRooms: 60,
        availableRooms: 52,
        amenities: [
          'Premium Wi-Fi',
          'Climate Control',
          'Rooftop Pool',
          'Spa & Wellness Center',
          'Multi-cuisine Restaurant',
          'Coffee Shop',
          'Business Center',
          'Valet Parking',
          'Executive Lounge',
          'Travel Desk'
        ],
        inclusions: [
          'Buffet breakfast',
          'High-speed internet',
          'Welcome amenities',
          'Evening tea/coffee',
          'Newspaper delivery',
          'Shoe shine service',
          'Porter service',
          'Safe deposit locker'
        ],
        exclusions: [
          'Lunch and dinner',
          'Alcoholic beverages',
          'Long distance calls',
          'Laundry charges',
          'Spa treatments',
          'Additional guest charges',
          'City tours',
          'Medical expenses'
        ],
        faqs: [
          {
            question: 'Do you have a spa?',
            answer: 'Yes, we have a full-service spa and wellness center.'
          },
          {
            question: 'Is there a rooftop pool?',
            answer: 'Yes, we have a beautiful rooftop swimming pool.'
          },
          {
            question: 'What dining options are available?',
            answer: 'We have a multi-cuisine restaurant and a coffee shop.'
          },
          {
            question: 'Do you offer valet parking?',
            answer: 'Yes, complimentary valet parking is available.'
          },
          {
            question: 'Is there an executive lounge?',
            answer: 'Yes, we have an executive lounge for premium guests.'
          },
          {
            question: 'Do you provide travel assistance?',
            answer: 'Yes, our travel desk can help with local tours and transportation.'
          },
          {
            question: 'Are there meeting facilities?',
            answer: 'Yes, we have state-of-the-art meeting and event facilities.'
          },
          {
            question: 'What is included in the breakfast?',
            answer: 'We offer a comprehensive buffet breakfast with Indian and continental options.'
          }
        ],
        rating: 4.2,
        location: 'Nehru Road, Shivamogga',
        checkInTime: '14:00',
        checkOutTime: '12:00'
      }
    ];

    await Accommodation.insertMany(accommodations);
    console.log('Accommodations created');

    console.log('Seed data created successfully!');
    console.log('Admin credentials: admin@aoa-shivamogga.org / admin123');
    
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedData();
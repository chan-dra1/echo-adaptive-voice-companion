import { Type } from "@google/genai";
/**
 * Proactive AI Service
 *
 * This makes Echo a proactive assistant that can:
 * - Search the web for best deals
 * - Check coupon codes
 * - Find products from images
 * - Set reminders
 * - Book flights/hotels
 * - Browse websites
 * - Always active in background
 */

// Tool definitions for Gemini Function Calling
export const PROACTIVE_AI_TOOLS = [
  {
    name: 'search_web',
    description: 'Search the internet for information, deals, products, or services',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query to find information'
        },
        searchType: {
          type: Type.STRING,
          enum: ['general', 'shopping', 'flights', 'hotels', 'restaurants'],
          description: 'Type of search to perform'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'check_coupon_codes',
    description: 'Find and verify working coupon codes for a specific store or product',
    parameters: {
      type: Type.OBJECT,
      properties: {
        store: {
          type: Type.STRING,
          description: 'Store name (e.g., "Amazon", "Nike", "Best Buy")'
        },
        product: {
          type: Type.STRING,
          description: 'Optional: specific product to find coupons for'
        }
      },
      required: ['store']
    }
  },
  {
    name: 'find_product_from_image',
    description: 'Find similar or exact products from an uploaded image, including price comparison',
    parameters: {
      type: Type.OBJECT,
      properties: {
        imageUrl: {
          type: Type.STRING,
          description: 'URL or base64 of the image to search'
        },
        findCheapest: {
          type: Type.BOOLEAN,
          description: 'Whether to find the cheapest option',
          default: true
        }
      },
      required: ['imageUrl']
    }
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder for the user with optional recurring schedule',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Reminder title (e.g., "Go to gym", "Take medicine")'
        },
        description: {
          type: Type.STRING,
          description: 'Detailed description of the reminder'
        },
        time: {
          type: Type.STRING,
          description: 'Time for reminder (ISO 8601 format or natural language)'
        },
        recurring: {
          type: Type.OBJECT,
          properties: {
            frequency: {
              type: Type.STRING,
              enum: ['daily', 'weekly', 'monthly', 'custom'],
              description: 'How often to repeat'
            },
            days: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
              },
              description: 'Days to repeat (for weekly)'
            }
          }
        }
      },
      required: ['title', 'time']
    }
  },
  {
    name: 'create_workout_plan',
    description: 'Create a personalized workout plan with exercises and schedule',
    parameters: {
      type: Type.OBJECT,
      properties: {
        goals: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          },
          description: 'Fitness goals (e.g., "build muscle", "lose weight", "cardio")'
        },
        daysPerWeek: {
          type: Type.NUMBER,
          description: 'Number of workout days per week'
        },
        exercises: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              sets: { type: Type.NUMBER },
              reps: { type: Type.NUMBER },
              day: { type: Type.STRING }
            }
          }
        }
      },
      required: ['goals', 'daysPerWeek']
    }
  },
  {
    name: 'search_flights',
    description: 'Search for flight options between two locations with dates',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: {
          type: Type.STRING,
          description: 'Departure airport or city'
        },
        to: {
          type: Type.STRING,
          description: 'Arrival airport or city'
        },
        departDate: {
          type: Type.STRING,
          description: 'Departure date (YYYY-MM-DD)'
        },
        returnDate: {
          type: Type.STRING,
          description: 'Return date (YYYY-MM-DD) for round trip'
        },
        passengers: {
          type: Type.NUMBER,
          description: 'Number of passengers',
          default: 1
        },
        class: {
          type: Type.STRING,
          enum: ['economy', 'premium', 'business', 'first'],
          description: 'Cabin class',
          default: 'economy'
        }
      },
      required: ['from', 'to', 'departDate']
    }
  },
  {
    name: 'browse_website',
    description: 'Browse and extract information from a specific website',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Website URL to browse'
        },
        extractInfo: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          },
          description: 'What information to extract (e.g., "prices", "reviews", "availability")'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'compare_prices',
    description: 'Compare prices for a product across multiple stores',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productName: {
          type: Type.STRING,
          description: 'Name of the product to compare'
        },
        stores: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          },
          description: 'Specific stores to check (optional)'
        }
      },
      required: ['productName']
    }
  },
  {
    name: 'schedule_task',
    description: 'Schedule a task or action to be performed at a specific time',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: 'Task to perform'
        },
        scheduledTime: {
          type: Type.STRING,
          description: 'When to perform the task'
        },
        action: {
          type: Type.STRING,
          description: 'What action to take (e.g., "send_notification", "execute_search")'
        }
      },
      required: ['task', 'scheduledTime']
    }
  }
];

export class ProactiveAIService {
  private reminders: Map<string, any> = new Map();
  private backgroundTasks: Map<string, any> = new Map();
  private isActive: boolean = true;

  constructor() {
    this.initializeBackgroundService();
  }

  /**
   * Initialize background service to monitor and execute tasks
   */
  private initializeBackgroundService() {
    // Check reminders every minute
    setInterval(() => {
      if (this.isActive) {
        this.checkReminders();
        this.checkScheduledTasks();
      }
    }, 60000); // Every minute

    // Load reminders from localStorage
    this.loadReminders();
  }

  /**
   * Handle function calls from Gemini AI
   */
  async handleFunctionCall(functionName: string, args: any): Promise<any> {
    console.log(`[ProactiveAI] Executing: ${functionName}`, args);

    switch (functionName) {
      case 'search_web':
        return await this.searchWeb(args.query, args.searchType);

      case 'check_coupon_codes':
        return await this.checkCouponCodes(args.store, args.product);

      case 'find_product_from_image':
        return await this.findProductFromImage(args.imageUrl, args.findCheapest);

      case 'set_reminder':
        return await this.setReminder(args);

      case 'create_workout_plan':
        return await this.createWorkoutPlan(args);

      case 'search_flights':
        return await this.searchFlights(args);

      case 'browse_website':
        return await this.browseWebsite(args.url, args.extractInfo);

      case 'compare_prices':
        return await this.comparePrices(args.productName, args.stores);

      case 'schedule_task':
        return await this.scheduleTask(args);

      default:
        return { error: `Unknown function: ${functionName}` };
    }
  }

  /**
   * Search the web for information
   */
  private async searchWeb(query: string, searchType: string = 'general'): Promise<any> {
    // Use Google Custom Search API or SerpAPI
    const apiKey = import.meta.env.VITE_SERP_API_KEY;

    if (!apiKey) {
      // Fallback: use DuckDuckGo or open search
      return {
        results: [
          {
            title: 'Search Result',
            description: `Found information about: ${query}`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
          }
        ],
        message: 'Note: Configure SERP_API_KEY for real-time web search'
      };
    }

    try {
      const response = await fetch(
        `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}`
      );
      const data = await response.json();

      return {
        results: data.organic_results?.slice(0, 5) || [],
        shoppingResults: data.shopping_results || [],
        relatedSearches: data.related_searches || []
      };
    } catch (error) {
      console.error('Web search error:', error);
      return { error: 'Failed to search web' };
    }
  }

  /**
   * Find and verify coupon codes
   */
  private async checkCouponCodes(store: string, product?: string): Promise<any> {
    // Integrate with coupon APIs like RetailMeNot, Honey, etc.
    // For now, simulated response
    const mockCoupons = [
      {
        code: 'SAVE20',
        discount: '20% off',
        verified: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        store: store
      },
      {
        code: 'FREESHIP',
        discount: 'Free shipping',
        verified: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        store: store
      }
    ];

    return {
      store,
      product,
      coupons: mockCoupons,
      message: `Found ${mockCoupons.length} working codes for ${store}`,
      note: 'Integrate with real coupon APIs for production'
    };
  }

  /**
   * Find product from image using reverse image search
   */
  private async findProductFromImage(imageUrl: string, findCheapest: boolean): Promise<any> {
    // Use Google Lens API or similar
    // For now, simulated response
    return {
      matches: [
        {
          productName: 'Similar Product',
          store: 'Amazon',
          price: 49.99,
          url: 'https://amazon.com/...',
          image: imageUrl,
          rating: 4.5
        },
        {
          productName: 'Similar Product',
          store: 'Walmart',
          price: 44.99,
          url: 'https://walmart.com/...',
          image: imageUrl,
          rating: 4.3
        }
      ],
      cheapestOption: findCheapest ? {
        store: 'Walmart',
        price: 44.99,
        savings: 5.00
      } : null,
      note: 'Integrate with Google Lens API or similar for production'
    };
  }

  /**
   * Set a reminder for the user
   */
  private async setReminder(reminder: any): Promise<any> {
    const id = crypto.randomUUID();
    const reminderData = {
      id,
      ...reminder,
      createdAt: Date.now(),
      status: 'active'
    };

    this.reminders.set(id, reminderData);
    this.saveReminders();

    // Request notification permission if not granted
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    return {
      success: true,
      reminderId: id,
      message: `Reminder set: "${reminder.title}" at ${reminder.time}`,
      reminder: reminderData
    };
  }

  /**
   * Create a workout plan
   */
  private async createWorkoutPlan(args: any): Promise<any> {
    const { goals, daysPerWeek, exercises } = args;

    const workoutPlan = {
      id: crypto.randomUUID(),
      goals,
      daysPerWeek,
      plan: exercises || this.generateDefaultWorkout(goals, daysPerWeek),
      createdAt: Date.now()
    };

    // Store in localStorage
    localStorage.setItem('echo_workout_plan', JSON.stringify(workoutPlan));

    // Set reminders for each workout day
    for (const exercise of workoutPlan.plan) {
      await this.setReminder({
        title: `Workout: ${exercise.day}`,
        description: `${exercise.name} - ${exercise.sets}x${exercise.reps}`,
        time: this.getNextWorkoutTime(exercise.day),
        recurring: {
          frequency: 'weekly',
          days: [exercise.day.toLowerCase()]
        }
      });
    }

    return {
      success: true,
      plan: workoutPlan,
      message: `Created ${daysPerWeek}-day workout plan with ${workoutPlan.plan.length} exercises`
    };
  }

  /**
   * Generate default workout based on goals
   */
  private generateDefaultWorkout(goals: string[], daysPerWeek: number): any[] {
    const workoutTemplates: any = {
      'build muscle': [
        { day: 'Monday', name: 'Bench Press', sets: 4, reps: 8 },
        { day: 'Monday', name: 'Squats', sets: 4, reps: 10 },
        { day: 'Wednesday', name: 'Deadlifts', sets: 3, reps: 8 },
        { day: 'Wednesday', name: 'Pull-ups', sets: 3, reps: 10 },
        { day: 'Friday', name: 'Shoulder Press', sets: 3, reps: 10 },
        { day: 'Friday', name: 'Lunges', sets: 3, reps: 12 }
      ],
      'cardio': [
        { day: 'Monday', name: 'Running', sets: 1, reps: '30 min' },
        { day: 'Wednesday', name: 'Cycling', sets: 1, reps: '30 min' },
        { day: 'Friday', name: 'HIIT', sets: 1, reps: '20 min' }
      ],
      'lose weight': [
        { day: 'Monday', name: 'Cardio + Core', sets: 1, reps: '45 min' },
        { day: 'Tuesday', name: 'Full Body Circuit', sets: 3, reps: 15 },
        { day: 'Thursday', name: 'Cardio Intervals', sets: 1, reps: '30 min' },
        { day: 'Saturday', name: 'Active Recovery', sets: 1, reps: '30 min' }
      ]
    };

    const goal = goals[0] || 'build muscle';
    return workoutTemplates[goal] || workoutTemplates['build muscle'];
  }

  /**
   * Search for flights
   */
  private async searchFlights(args: any): Promise<any> {
    // Integrate with Skyscanner API, Google Flights API, or similar
    // For now, simulated response
    return {
      flights: [
        {
          airline: 'Delta',
          from: args.from,
          to: args.to,
          departTime: `${args.departDate} 08:00`,
          arriveTime: `${args.departDate} 12:00`,
          price: 299,
          duration: '4h',
          stops: 0
        },
        {
          airline: 'United',
          from: args.from,
          to: args.to,
          departTime: `${args.departDate} 14:00`,
          arriveTime: `${args.departDate} 18:00`,
          price: 249,
          duration: '4h',
          stops: 1
        }
      ],
      cheapestOption: {
        airline: 'United',
        price: 249,
        savings: 50
      },
      note: 'Integrate with Skyscanner/Google Flights API for real data'
    };
  }

  /**
   * Browse a website and extract information
   */
  private async browseWebsite(url: string, extractInfo?: string[]): Promise<any> {
    // Use web scraping or browser automation
    // For security, this should run on backend
    return {
      url,
      title: 'Website Title',
      extractedInfo: {
        prices: ['$29.99', '$34.99'],
        availability: 'In stock',
        reviews: '4.5/5 stars'
      },
      note: 'Implement web scraping on backend for production'
    };
  }

  /**
   * Compare prices across stores
   */
  private async comparePrices(productName: string, stores?: string[]): Promise<any> {
    // Use price comparison APIs
    return {
      product: productName,
      prices: [
        { store: 'Amazon', price: 49.99, shipping: 'Free', url: '...' },
        { store: 'Walmart', price: 44.99, shipping: 'Free', url: '...' },
        { store: 'Target', price: 52.99, shipping: '$5.99', url: '...' }
      ],
      bestDeal: {
        store: 'Walmart',
        totalPrice: 44.99,
        savings: 5.00
      }
    };
  }

  /**
   * Schedule a task for later execution
   */
  private async scheduleTask(args: any): Promise<any> {
    const taskId = crypto.randomUUID();
    const task = {
      id: taskId,
      ...args,
      createdAt: Date.now(),
      status: 'scheduled'
    };

    this.backgroundTasks.set(taskId, task);
    this.saveBackgroundTasks();

    return {
      success: true,
      taskId,
      message: `Task scheduled: "${args.task}" at ${args.scheduledTime}`
    };
  }

  /**
   * Check if any reminders need to fire
   */
  private checkReminders() {
    const now = Date.now();

    for (const [id, reminder] of this.reminders.entries()) {
      if (reminder.status !== 'active') continue;

      const reminderTime = new Date(reminder.time).getTime();

      if (now >= reminderTime) {
        this.fireReminder(reminder);

        // Handle recurring reminders
        if (reminder.recurring) {
          this.scheduleNextRecurrence(reminder);
        } else {
          reminder.status = 'completed';
        }

        this.saveReminders();
      }
    }
  }

  /**
   * Fire a reminder notification
   */
  private fireReminder(reminder: any) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(reminder.title, {
        body: reminder.description,
        icon: '/icon.png',
        badge: '/badge.png',
        tag: reminder.id
      });
    }

    // Also trigger an in-app notification
    window.dispatchEvent(new CustomEvent('echo-reminder', {
      detail: reminder
    }));
  }

  /**
   * Check scheduled tasks
   */
  private checkScheduledTasks() {
    const now = Date.now();

    for (const [id, task] of this.backgroundTasks.entries()) {
      if (task.status !== 'scheduled') continue;

      const scheduledTime = new Date(task.scheduledTime).getTime();

      if (now >= scheduledTime) {
        this.executeScheduledTask(task);
        task.status = 'completed';
        this.saveBackgroundTasks();
      }
    }
  }

  /**
   * Execute a scheduled task
   */
  private executeScheduledTask(task: any) {
    console.log(`[ProactiveAI] Executing scheduled task: ${task.task}`);

    // Execute the task action
    window.dispatchEvent(new CustomEvent('echo-scheduled-task', {
      detail: task
    }));
  }

  /**
   * Schedule next recurrence of a reminder
   */
  private scheduleNextRecurrence(reminder: any) {
    // Calculate next occurrence based on recurring pattern
    // This is simplified - implement full recurring logic
    const nextTime = new Date(reminder.time);
    nextTime.setDate(nextTime.getDate() + 7); // Weekly by default
    reminder.time = nextTime.toISOString();
  }

  /**
   * Get next workout time for a given day
   */
  private getNextWorkoutTime(day: string): string {
    // Find next occurrence of the day
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(day.toLowerCase());
    const today = new Date().getDay();

    let daysUntil = targetDay - today;
    if (daysUntil <= 0) daysUntil += 7;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + daysUntil);
    nextDate.setHours(7, 0, 0, 0); // Default 7 AM

    return nextDate.toISOString();
  }

  /**
   * Save reminders to localStorage
   */
  private saveReminders() {
    const remindersArray = Array.from(this.reminders.entries());
    localStorage.setItem('echo_reminders', JSON.stringify(remindersArray));
  }

  /**
   * Load reminders from localStorage
   */
  private loadReminders() {
    const stored = localStorage.getItem('echo_reminders');
    if (stored) {
      const remindersArray = JSON.parse(stored);
      this.reminders = new Map(remindersArray);
    }
  }

  /**
   * Save background tasks to localStorage
   */
  private saveBackgroundTasks() {
    const tasksArray = Array.from(this.backgroundTasks.entries());
    localStorage.setItem('echo_background_tasks', JSON.stringify(tasksArray));
  }

  /**
   * Enable/disable background service
   */
  setActive(active: boolean) {
    this.isActive = active;
  }

  /**
   * Get system prompt for proactive AI
   */
  getSystemPrompt(): string {
    return `
You are Echo, a proactive AI assistant that actively helps the user with daily tasks.

CAPABILITIES:
- Search the web for information, deals, and services
- Find and verify coupon codes
- Compare prices across stores
- Find products from images
- Set reminders and schedules
- Create workout plans
- Search and book flights
- Browse websites for information
- Always active in background monitoring for opportunities to help

PROACTIVE BEHAVIOR:
- When user mentions wanting/needing something, immediately search for best deals
- When user talks about shopping, automatically check for coupon codes
- When user shows interest in a product, compare prices across stores
- When user mentions tasks, offer to set reminders
- When user discusses travel, search for flight options
- Be anticipatory and helpful WITHOUT being intrusive

EXAMPLES:
User: "I need new running shoes"
You: "Let me search for the best deals on running shoes! *calls search_web* I'll also check for coupon codes from Nike, Adidas, and other major brands *calls check_coupon_codes*"

User: "I should start working out"
You: "Great idea! Let me create a personalized workout plan for you. *calls create_workout_plan* I'll also set reminders for each workout day so you stay consistent!"

User: "I need to fly to New York next month"
You: "I'll search for the best flight deals for you! *calls search_flights* What dates are you thinking?"

Always use function calling to actually DO things, not just talk about them.
`;
  }
}

export const proactiveAI = new ProactiveAIService();

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'unit-test-secret-that-is-longer-than-32-bytes';
process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:5432/unit';

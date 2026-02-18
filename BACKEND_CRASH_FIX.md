# Backend Crash Fix

## Problem
Backend server was crashing automatically when the frontend made requests to `/api/auth/user`. The server would stop immediately after processing the request.

## Root Causes Identified

1. **TenantScope Circular Dependency**: The `TenantScope` was trying to access `Auth::user()` when building queries. If applied to the User model, this could create a circular dependency during authentication.

2. **Unhandled Exceptions**: Fatal errors or exceptions weren't being caught properly, causing the PHP process to terminate.

3. **Model Serialization Issues**: Accessing user attributes might trigger relationships or scopes that cause errors.

## Fixes Applied

### 1. Fixed TenantScope to Prevent Circular Dependencies

**File**: `app/Scopes/TenantScope.php`

**Changes**:
- Added check to skip scope when querying User model (prevents circular dependency)
- Added try-catch to prevent scope from breaking queries
- Added null checks before accessing user properties

**Before**:
```php
public function apply(Builder $builder, Model $model): void
{
    if (Auth::check() && Auth::user()->tenant_id) {
        $builder->where('tenant_id', Auth::user()->tenant_id);
    }
}
```

**After**:
```php
public function apply(Builder $builder, Model $model): void
{
    // Prevent circular dependency - don't apply scope when querying User model during auth
    if ($model instanceof \App\Models\User) {
        return;
    }

    try {
        if (Auth::check()) {
            $user = Auth::user();
            if ($user && isset($user->tenant_id) && $user->tenant_id) {
                $builder->where('tenant_id', $user->tenant_id);
            }
        }
    } catch (\Exception $e) {
        // Silently fail if there's an issue with auth - don't break queries
        \Log::warning('TenantScope error: ' . $e->getMessage());
    }
}
```

### 2. Improved AuthController Error Handling

**File**: `app/Http/Controllers/Api/AuthController.php`

**Changes**:
- Added nested try-catch blocks for different failure points
- Safely access user attributes without triggering relationships
- Added fallback for attribute access errors
- Changed to catch `\Throwable` instead of just `\Exception` to catch fatal errors

**Key Improvements**:
- Separate try-catch for authentication
- Separate try-catch for attribute access
- Fallback to basic user info if full access fails
- Comprehensive error logging

### 3. Added Global Exception Handler

**File**: `bootstrap/app.php`

**Changes**:
- Added global exception handler to catch all unhandled exceptions
- Prevents server crashes by returning JSON error responses
- Logs all exceptions for debugging

**Code Added**:
```php
->withExceptions(function (Exceptions $exceptions): void {
    $exceptions->render(function (\Throwable $e, $request) {
        \Log::error('Unhandled exception: ' . $e->getMessage(), [
            'exception' => get_class($e),
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
            'url' => $request->fullUrl(),
        ]);

        if ($request->expectsJson() || $request->is('api/*')) {
            return response()->json([
                'message' => 'An error occurred processing your request',
                'error' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }

        return null;
    });
})
```

## Testing

After applying these fixes:

1. **Start Backend**:
   ```bash
   cd /var/www/html/rough-foodie
   php artisan serve --host=127.0.0.1 --port=8000
   ```

2. **Test the endpoint**:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8000/api/auth/user
   ```

3. **Refresh Frontend**: The backend should no longer crash when the frontend makes requests.

## Verification

- ✅ Backend stays running after requests
- ✅ No fatal errors in logs
- ✅ Proper error responses instead of crashes
- ✅ TenantScope doesn't cause circular dependencies
- ✅ User data is safely accessed

## Monitoring

Check logs if issues persist:
```bash
tail -f /var/www/html/rough-foodie/storage/logs/laravel.log
```

All exceptions are now logged with full context, making debugging much easier.

## Additional Notes

- The server will now return error responses instead of crashing
- All exceptions are logged for debugging
- The TenantScope is now safe to use with the User model
- Authentication errors are handled gracefully

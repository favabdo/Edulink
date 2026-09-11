using EduspaceApi.Models;

namespace EduspaceApi.Contracts;

public record LoginRequest(string? Email, string? Password);

public record CreateUserRequest(string? Name, string? Email, string? Password, short Role, short Access = 1, short States = 0);

public record BootstrapOwnerRequest(string? Name, string? Email, string? Password);

public record UserDto(
    long Id,
    string? Name,
    string Email,
    short Role,
    string RoleName,
    short States,
    short Access,
    string? ImgUrl,
    DateTimeOffset CreatedAt);

public record AuthResponse(string Token, UserDto User);

public static class UserMapping
{
    public static UserDto ToDto(this EduUser u) => new(
        u.Id,
        u.Name,
        u.Email,
        u.Role,
        UserRoles.ToArabicName(u.Role),
        u.States,
        u.Access,
        u.ImgUrl,
        u.CreatedAt);
}
